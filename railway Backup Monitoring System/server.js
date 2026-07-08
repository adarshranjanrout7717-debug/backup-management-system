require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const oracledb = require("oracledb");
const cors = require("cors");
const net = require("net");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt"); // ✅ FIXED
const cron = require("node-cron");

const app = express();

app.use(cors());
app.use(express.json());

// serve frontend
app.use(express.static(__dirname));

// ------------------- DB CONNECTION -------------------
// Pool instead of a single mysql.createConnection(). A plain connection
// is fragile: once mysql2 marks an error "fatal" (like the
// ER_DATA_TOO_LONG below, or a dropped/blocked connection), it destroys
// the underlying socket permanently - every query after that throws
// synchronously with "Can't add new command when connection is in
// closed state", which is an uncaught exception outside any callback
// and crashes the whole process (this is what actually killed the
// server on the second crash, even after db.on("error") stopped the
// first one). A pool hands out a fresh connection per query and
// quietly drops/replaces a dead one, so one bad query can't take
// everything else down with it. db.query(...) keeps working exactly
// as before - Pool exposes the same .query() method as Connection.
const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "Adarsh@7978",
    database: "backup_monitoring",
    dateStrings: true, // return dates as plain text (e.g. "2026-06-25 12:02:12")
                        // instead of JS Date objects, which res.json() would
                        // otherwise convert to UTC text with a trailing "Z"
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Quick check at startup so we still get the familiar log line, even
// though a pool doesn't "connect" up front the way a single connection
// does - it opens connections lazily as queries come in.
db.query("SELECT 1", (err) => {
    if (err) {
        console.log("Database Connection Failed");
        console.log(err);
    } else {
        console.log("Database Connected Successfully");
    }
});

// Reusable migration helper: adds `column` to `table` only if it
// doesn't already exist, checking information_schema first since
// "ADD COLUMN IF NOT EXISTS" isn't supported on every MySQL version
// (this server rejected it with a syntax error when tried directly).
function ensureColumnExists(table, column, definition) {

    db.query(
        `SELECT COUNT(*) AS cnt
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
         AND table_name = ?
         AND column_name = ?`,
        [table, column],
        (err, rows) => {

            if (err) {
                console.log(`Migration check (${table}.${column}) failed:`, err.message);
                return;
            }

            if (rows[0].cnt > 0) {
                return;
            }

            db.query(
                `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
                (alterErr) => {
                    if (alterErr) {
                        console.log(`Migration (${table}.${column}) failed:`, alterErr.message);
                    } else {
                        console.log(`Migration: added ${table}.${column}`);
                    }
                }
            );

        }
    );

}

// backup_logs.triggered_by_username: lets a non-admin's Reports page
// show only backups THEY personally ran, instead of every backup ever
// run on any instance assigned to them.
ensureColumnExists("backup_logs", "triggered_by_username", "VARCHAR(100) NULL");

// scheduled_backups.triggered_by_username: records who scheduled a
// backup at the time it's created, so executeScheduledBackups() can
// carry that same attribution through to servers.last_backup_triggered_by
// below without an extra lookup.
ensureColumnExists("scheduled_backups", "triggered_by_username", "VARCHAR(100) NULL");

// servers.last_backup_triggered_by: powers the "Last Backup Done By"
// line shown on the Instance Details panel (admin view only).
ensureColumnExists("servers", "last_backup_triggered_by", "VARCHAR(100) NULL");

// Belt-and-suspenders: even with a pool, log any error event instead
// of letting it crash the process if one ever escapes to this level.
db.on("error", (dbErr) => {
    console.log("MySQL pool error (non-fatal to the process):", dbErr);
});

// backup_logs.remarks is a fixed-size column - real-world error text
// from mysqldump/expdp stderr can run to several hundred bytes or
// more, so anything going into that column needs truncating first or
// the INSERT/UPDATE fails with ER_DATA_TOO_LONG. 200 is intentionally
// conservative (safely under a typical VARCHAR(255)); if you widen the
// remarks column to TEXT, you can raise this limit accordingly - run:
//   ALTER TABLE backup_logs MODIFY remarks TEXT;
// to remove the practical ceiling entirely.
function truncateForDb(text, maxLen = 200) {

    if (text === null || text === undefined) {
        return text;
    }

    const str = String(text);

    if (str.length <= maxLen) {
        return str;
    }

    return str.slice(0, maxLen - 3) + "...";
}

// Strict IPv4 validator: exactly 4 dot-separated octets, each 0-255,
// no letters, no extra/missing dots, no leading/trailing/inner spaces,
// no negative numbers. "localhost" and hostnames are NOT accepted.
function isValidIPv4(ip) {

    if (typeof ip !== "string") {
        return false;
    }

    const ipv4Regex =
        /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;

    return ipv4Regex.test(ip);
}

// Formats a byte count for display: KB while under 1MB (so small
// files don't show up as a misleading "0.00 MB"), MB from 1MB up.
function formatFileSize(bytes) {

    if (bytes < 1024 * 1024) {
        return (bytes / 1024).toFixed(2) + " KB";
    }

    return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

///////////////////////////////////////////////////////
// ORACLE LOGICAL BACKUP (dynamic table -> INSERT dump)
///////////////////////////////////////////////////////
// Replaces the old expdp/DIRECTORY-object approach. Node connects
// directly with oracledb, discovers every table owned by the target
// schema, and writes each row out as a plain INSERT statement into a
// single .sql file. Because Node itself is the process writing the
// file (not the Oracle service), the old "Oracle service can only see
// C:\" restriction no longer applies - any backup_path works.
//
// Limitations worth knowing about:
//   - Only tables owned by server.db_username (user_tables) are dumped,
//     matching the old SCHEMAS=server.db_username scope.
//   - DATE/TIMESTAMP columns are written as TO_DATE('...', 'YYYY-MM-DD HH24:MI:SS').
//   - BLOB columns are hex-encoded via RAWTOHEX and truncated to the
//     first 2000 bytes (a SQL string literal can't safely hold an
//     arbitrarily large BLOB) - large binary columns need a separate
//     export strategy if you need full fidelity.
//   - No DDL (CREATE TABLE) is emitted, only data - the target schema
//     is assumed to already exist when restoring.

function formatSqlValue(value, dataType) {

    if (value === null || value === undefined) {
        return "NULL";
    }

    if (dataType === "DATE" || (dataType && dataType.startsWith("TIMESTAMP"))) {
        // value has already been converted to 'YYYY-MM-DD HH24:MI:SS'
        // text by the TO_CHAR() wrapped around it in the SELECT list.
        return `TO_DATE('${value}', 'YYYY-MM-DD HH24:MI:SS')`;
    }

    if (dataType === "BLOB") {
        // value is already hex text via RAWTOHEX(DBMS_LOB.SUBSTR(...)) in the SELECT.
        return value ? `HEXTORAW('${value}')` : "NULL";
    }

    if (typeof value === "number") {
        return String(value);
    }

    // Default: VARCHAR2 / CHAR / CLOB (small CLOBs come back as JS
    // strings from oracledb by default) / anything else stringifiable.
    return `'${String(value).replace(/'/g, "''")}'`;
}

// Finds every table the connecting user can actually read - not just
// tables it owns. USER_TABLES (queried before this fix) only returns
// tables owned by the connected user, so a dedicated low-privilege
// backup account (owns nothing, just has SELECT grants on another
// schema's tables - like "backupuser" here) always came back empty.
// ALL_TABLES returns everything visible to the current user (owned,
// directly granted, or via a role), which is what we actually want.
// Joining to ALL_USERS.ORACLE_MAINTAINED='N' filters out Oracle's own
// internal accounts (SYS, SYSTEM, XDB, CTXSYS, etc.) so we don't try
// to "back up" the data dictionary.
//
// SYS_EXPORT_%/SYS_IMPORT_% tables are excluded too - these are
// Data Pump's own job-tracking master tables (leftover from any past
// expdp/impdp run against this schema), not real application data.
// They have huge, ever-changing column lists and show up as noise in
// every dump otherwise.
async function getBackupTables(connection) {

    const result = await connection.execute(
        `SELECT t.owner, t.table_name
         FROM all_tables t
         JOIN all_users u ON u.username = t.owner
         WHERE u.oracle_maintained = 'N'
         AND t.table_name NOT LIKE 'SYS_EXPORT%'
         AND t.table_name NOT LIKE 'SYS_IMPORT%'
         ORDER BY t.owner, t.table_name`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    return result.rows.map(r => ({ owner: r.OWNER, tableName: r.TABLE_NAME }));
}

// Fetches the CREATE TABLE DDL for one table via DBMS_METADATA, so the
// Oracle dump includes table structure like mysqldump does - not just
// INSERT statements. Returns null (rather than throwing) if this
// fails, since GET_DDL on another schema's object requires
// SELECT_CATALOG_ROLE (or similar) in addition to plain SELECT access
// - a low-privilege backup account may not have that. Callers should
// fall back to a comment noting DDL wasn't available, and still dump
// the data.
async function getTableDdl(connection, owner, tableName) {

    try {

        const result = await connection.execute(
            `SELECT DBMS_METADATA.GET_DDL('TABLE', :tableName, :owner) AS ddl FROM DUAL`,
            { tableName, owner },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        const ddl = result.rows[0].DDL;

        // GET_DDL can return a CLOB (lob object) or a plain string
        // depending on driver/version - normalize to a string either way.
        if (ddl && typeof ddl.getData === "function") {
            return await ddl.getData();
        }

        return ddl;

    } catch (err) {

        console.log(`Could not fetch DDL for ${owner}.${tableName}:`, err.message);
        return null;

    }

}

async function dumpTable(connection, owner, tableName, writeStream) {

    const qualifiedName = `"${owner}"."${tableName}"`;

    // Table structure first, matching mysqldump's shape (DROP + CREATE
    // before the data). Oracle has no native "DROP TABLE IF EXISTS"
    // pre-23c, so this uses the standard PL/SQL idiom: attempt the
    // drop, and swallow ORA-00942 (table/view does not exist) via
    // exception handling, re-raising anything else.
    const ddl = await getTableDdl(connection, owner, tableName);

    writeStream.write(`\n-- Table structure for ${qualifiedName}\n`);

    if (ddl) {

        writeStream.write(
            `BEGIN\n` +
            `   EXECUTE IMMEDIATE 'DROP TABLE ${qualifiedName}';\n` +
            `EXCEPTION\n` +
            `   WHEN OTHERS THEN\n` +
            `      IF SQLCODE != -942 THEN RAISE; END IF;\n` +
            `END;\n/\n\n`
        );

        writeStream.write(ddl.trim() + ";\n");

    } else {

        writeStream.write(
            `-- DDL not available (the connected user likely lacks SELECT_CATALOG_ROLE ` +
            `or similar catalog access needed for DBMS_METADATA.GET_DDL on another schema's ` +
            `object) - only data follows below, the table itself must already exist to restore into.\n`
        );

    }

    // Column list + types up front so DATE/TIMESTAMP/BLOB columns can
    // be specially wrapped in the SELECT before we ever read rows.
    // ALL_TAB_COLUMNS (not USER_TAB_COLUMNS) so this works whether the
    // table is owned by the connecting user or just granted to it.
    const colsResult = await connection.execute(
        `SELECT column_name, data_type
         FROM all_tab_columns
         WHERE owner = :owner
         AND table_name = :tableName
         ORDER BY column_id`,
        { owner, tableName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const columns = colsResult.rows;

    if (columns.length === 0) {
        return 0;
    }

    const selectList = columns.map(col => {
        const name = col.COLUMN_NAME;
        const type = col.DATA_TYPE;

        if (type === "DATE" || type.startsWith("TIMESTAMP")) {
            return `TO_CHAR("${name}", 'YYYY-MM-DD HH24:MI:SS') AS "${name}"`;
        }
        if (type === "BLOB") {
            return `RAWTOHEX(DBMS_LOB.SUBSTR("${name}", 2000, 1)) AS "${name}"`;
        }
        return `"${name}"`;
    }).join(", ");

    writeStream.write(`\n-- Dumping data for table ${qualifiedName}\n`);

    const columnNames = columns.map(c => c.COLUMN_NAME);
    const dataTypes = {};
    columns.forEach(c => { dataTypes[c.COLUMN_NAME] = c.DATA_TYPE; });

    // INSERTs are written back out fully schema-qualified (owner
    // included) so the dump is unambiguous about where each row came
    // from - if restoring into a differently-named schema, strip or
    // edit the owner prefix in the generated file.
    const insertPrefix =
        `INSERT INTO ${qualifiedName} (${columnNames.map(c => `"${c}"`).join(", ")}) VALUES (`;

    const result = await connection.execute(
        `SELECT ${selectList} FROM ${qualifiedName}`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT, resultSet: true }
    );

    const rs = result.resultSet;
    let rowCount = 0;
    let row;

    // Stream row-by-row instead of loading the whole table into memory
    // at once - matters for tables with more than a few thousand rows.
    while ((row = await rs.getRow())) {

        const values = columnNames.map(colName =>
            formatSqlValue(row[colName], dataTypes[colName])
        );

        writeStream.write(insertPrefix + values.join(", ") + ");\n");
        rowCount++;
    }

    await rs.close();

    writeStream.write(`-- ${rowCount} row(s) inserted into ${qualifiedName}\n`);

    return rowCount;
}

function runOracleLogicalBackup(server, server_name, backup_path) {

    return new Promise((resolve) => {

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const dumpFileName = `${server_name}_${timestamp}.sql`;
        const backupFile = path.join(backup_path, dumpFileName);

        (async () => {

            let connection;

            try {

                connection = await oracledb.getConnection({
                    user: server.db_username,
                    password: server.db_password,
                    connectString: `${server.ip_address}:${server.port_number}/${server.db_name}`
                });

                // Strip environment-specific storage/tablespace clauses
                // from every GET_DDL call this session makes, so the
                // CREATE TABLE output is portable across environments
                // instead of tied to this exact database's tablespace
                // layout and storage settings. Session-scoped, so this
                // only needs to run once per connection, not per table.
                // Non-fatal if it fails (e.g. insufficient privilege) -
                // DDL just comes back with the extra clauses included.
                try {
                    await connection.execute(
                        `BEGIN
                            DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'STORAGE', FALSE);
                            DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'TABLESPACE', FALSE);
                            DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SEGMENT_ATTRIBUTES', FALSE);
                         END;`
                    );
                } catch (transformErr) {
                    console.log("Could not set DBMS_METADATA transform params (DDL will include storage/tablespace clauses):", transformErr.message);
                }

                const tables = await getBackupTables(connection);

                if (tables.length === 0) {
                    await connection.close();
                    return resolve({
                        success: false,
                        message: `No accessible tables found for user ${server.db_username} (checked owned tables and tables granted to it)`
                    });
                }

                console.log("Backup File:", backupFile);
                console.log(`Dumping ${tables.length} table(s) accessible to ${server.db_username}`);

                const writeStream = fs.createWriteStream(backupFile, { encoding: "utf8" });

                writeStream.write(
                    `-- RBMS Logical Backup\n` +
                    `-- Connected as: ${server.db_username}\n` +
                    `-- Generated: ${new Date().toISOString()}\n`
                );

                for (const { owner, tableName } of tables) {
                    await dumpTable(connection, owner, tableName, writeStream);
                }

                await new Promise((res) => writeStream.end(res));
                await connection.close();

                resolve({ success: true, backupFile });

            } catch (err) {

                console.log(err);

                if (connection) {
                    try {
                        await connection.close();
                    } catch (closeErr) {
                        console.log(closeErr);
                    }
                }

                resolve({
                    success: false,
                    message: err.message
                });
            }

        })();

    });
}

///////////////////////////////////////////////////////
// SHARED BACKUP EXECUTION (MySQL + Oracle)
///////////////////////////////////////////////////////
// Used by BOTH "/start-backup" and executeScheduledBackups(), so the
// database_type branching only exists in one place. Before this fix,
// executeScheduledBackups() had its own copy of ONLY the MySQL exec
// logic - so a scheduled Oracle backup would try to run mysqldump
// against an Oracle connection and always fail with "Lost connection
// to MySQL server ... reading initial communication packet", exactly
// like what you saw in the logs.
//
// Returns a Promise that resolves (never rejects) to:
//   { success: true,  backupFile }
//   { success: false, message }
function runDatabaseBackup(server, server_name, backup_path) {

    return new Promise((resolve) => {

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

        // ============================================================
        // MYSQL
        // ============================================================
        if (server.database_type === "MySQL") {

            const backupFile = path.join(
                backup_path,
                `${server_name}_${timestamp}.sql`
            );

            const command =
                `"C:\\Program Files\\MySQL\\MySQL Server 9.6\\bin\\mysqldump.exe" --no-tablespaces -h ${server.ip_address} -P ${server.port_number} -u ${server.db_username} -p${server.db_password} ${server.db_name} > "${backupFile}"`;

            console.log("Backup File:", backupFile);
            console.log("Command:", command);

            exec(command, (error) => {

                if (error) {
                    console.log(error);
                    return resolve({
                        success: false,
                        message: error.message
                    });
                }

                resolve({ success: true, backupFile });
            });

            return;
        }

        // ============================================================
        // ORACLE
        // ============================================================
        // Dynamic logical backup: connect -> list tables -> read rows ->
        // write INSERT statements. See runOracleLogicalBackup() above.
        if (server.database_type === "Oracle") {

            runOracleLogicalBackup(server, server_name, backup_path)
                .then(resolve);

            return;
        }

        // ============================================================
        // UNKNOWN DATABASE TYPE
        // ============================================================
        resolve({
            success: false,
            message: `Unsupported database type: ${server.database_type}`
        });
    });
}

// ------------------- JWT MIDDLEWARE -------------------
function verifyToken(req, res, next) {

    const authHeader = req.headers["authorization"];

    if (!authHeader) {
        return res.json({ success: false, message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.json({ success: false, message: "Invalid token" });
    }
}

// ------------------- SERVERS -------------------
app.get(
"/servers",
verifyToken,
(req,res)=>{

if(req.user.role === "admin"){

    db.query(
    "SELECT * FROM servers",
    (err,result)=>{
        res.json(result);
    });

}
else{

    const sql = `
    SELECT s.*
    FROM servers s
    JOIN instance_assignments ia
    ON s.id = ia.server_id
    WHERE ia.user_id = ?
    `;

    db.query(
    sql,
    [req.user.id],
    (err,result)=>{

        res.json(result);

    });

}

});

app.post("/add-server", verifyToken, verifyAdmin, (req, res) => {

    const {
        server_name,
        ip_address,
        database_type,
        port_number,
        db_name,
        db_username,
        db_password

    } = req.body;

    // Basic Validation

    if (
        !server_name ||
        !ip_address ||
        !database_type ||
        !port_number
    ) {

        return res.json({
            success: false,
            message: "All fields are required"
        });

    }

    // IPv4 Validation - exactly 4 dot-separated octets, each 0-255,
    // no letters/special chars, no spaces, no extra dots, no negatives.
    // Note: this rejects "localhost" - use 127.0.0.1 instead.
    if (!isValidIPv4(ip_address)) {

        return res.json({
            success: false,
            message: "Invalid IP Address. Use a valid IPv4 address (e.g. 192.168.1.1)."
        });

    }

    // Duplicate Check
    //
    // ip_address + port_number ALONE used to be enough to call something
    // a duplicate - too loose, since one server commonly hosts several
    // separate databases. db_name + database_type were added to fix
    // that. But db_name alone isn't enough either, specifically for
    // Oracle: a single Oracle instance/PDB (e.g. "XEPDB1") is normally
    // shared by every schema on that server, so two genuinely different
    // Oracle logins (like "railway" and "railway_test1") both connect
    // through the same db_name - db_username is what actually
    // distinguishes them. Including db_username here also does no harm
    // for MySQL, where distinct logical databases already differ by
    // db_name anyway. The full identity is now: same server, same
    // port, same database, same engine, same login. server_name is
    // still checked on its own since two rows with an identical display
    // name would be confusing in the UI regardless of what they connect to.
    const checkSql = `
        SELECT id
        FROM servers
        WHERE server_name = ?
        OR (
            ip_address = ?
            AND port_number = ?
            AND db_name = ?
            AND database_type = ?
            AND db_username = ?
        )
    `;

    db.query(
        checkSql,
        [
            server_name,
            ip_address,
            port_number,
            db_name,
            database_type,
            db_username
        ],
        (err, rows) => {

            if (err) {

                console.log(err);

                return res.json({
                    success: false,
                    message: "Database Error"
                });

            }

            if (rows.length > 0) {

                return res.json({
                    success: false,
                    message: "Instance already exists"
                });

            }

            // Verify Connection

            const startTime = Date.now();

            const socket = new net.Socket();

            socket.setTimeout(3000);

            socket.connect(
                port_number,
                ip_address,
                () => {

                    const responseTime =
                        Date.now() - startTime;

                    socket.destroy();

                    const insertSql = `
                        INSERT INTO servers
                        (
                            server_name,
                            ip_address,
                            database_type,
                            port_number,
                            db_name,
                            db_username,
                            db_password,
                            status,
                            connection_status,
                            response_time_ms,
                            last_checked_time
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?,?, ?, ?, NOW())
                    `;

                    db.query(
                        insertSql,
                        [
                            server_name,
                            ip_address,
                            database_type,
                            port_number,
                            db_name,
                            db_username,
                            db_password,
                            "Active",
                            "Online",
                            responseTime
                        ],
                        (insertErr) => {

                            if (insertErr) {

                                console.log(insertErr);

                                return res.json({
                                    success: false,
                                    message: "Insert Failed"
                                });

                            }

                            res.json({
                                success: true,
                                message: "Instance Added Successfully"
                            });

                        }
                    );

                }
            );

            socket.on("error", () => {

                return res.json({
                    success: false,
                    message: "Server is unreachable"
                });

            });

            socket.on("timeout", () => {

                socket.destroy();

                return res.json({
                    success: false,
                    message: "Connection Timeout"
                });

            });

        }
    );

});

// ------------------- BACKUP LOGS -------------------
app.get("/backup-logs", verifyToken, (req, res) => {

    if (req.user.role === "admin") {

        db.query("SELECT * FROM backup_logs ORDER BY id DESC", (err, result) => {
            if (err) return res.json([]);
            res.json(result);
        });

        return;
    }

    // Non-admin: only backups THIS user personally triggered (ran
    // Backup Now or scheduled) - not every backup ever run on an
    // instance assigned to them, which could include ones the admin
    // ran before handing the instance over. Older rows created before
    // triggered_by_username existed will have it as NULL and won't
    // show here for non-admins - only admin sees those (expected, since
    // there's no way to retroactively know who ran them).
    const sql = `
        SELECT *
        FROM backup_logs
        WHERE triggered_by_username = ?
        ORDER BY id DESC
    `;

    db.query(sql, [req.user.username], (err, result) => {
        if (err) return res.json([]);
        res.json(result);
    });

});

// ------------------- START BACKUP -------------------
// Delegates the actual MySQL/Oracle exec work to runDatabaseBackup() so
// the same branching logic is shared with executeScheduledBackups().
app.post("/start-backup", verifyToken, (req, res) => {

    console.log("START BACKUP CLICKED");

    const {
        server_name,
        backup_type,
        backup_location,
        backup_path
    } = req.body;

    db.query(
        "SELECT * FROM servers WHERE server_name=?",
        [server_name],
        async (err, result) => {

            if (err || result.length === 0) {
                return res.json({
                    success: false,
                    message: "Server not found"
                });
            }

            const server = result[0];

            if (!backup_path) {
                return res.json({ success: false, message: "Backup Path Required" });
            }

            try {
                if (!fs.existsSync(backup_path)) {
                    fs.mkdirSync(backup_path, { recursive: true });
                }
            } catch (err) {
                return res.json({ success: false, message: err.message });
            }

            const startTime = Date.now();

            const result1 = await runDatabaseBackup(server, server_name, backup_path);

            if (!result1.success) {

                // Previously a failed immediate backup only returned an
                // error to the browser and never touched backup_logs at
                // all, so it never showed up in Reports - unlike a
                // failed scheduled backup, which already had a row to
                // update to Failed. Insert one here too, so every
                // attempted backup (success or failure) leaves a trace.
                db.query(`
                    INSERT INTO backup_logs
                    (server_name, backup_type, database_type, status, remarks, backup_location, triggered_by_username)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    server_name,
                    backup_type,
                    server.database_type,
                    "Failed",
                    truncateForDb(result1.message),
                    backup_path,
                    req.user.username
                ]);

                return res.json({
                    success: false,
                    message: result1.message
                });
            }

            const backupFile = result1.backupFile;

            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2) + " sec";

            let sizeMB;
            try {
                const stats = fs.statSync(backupFile);
                sizeMB = formatFileSize(stats.size);
            } catch (statErr) {

                const failMessage =
                    "Backup command ran but output file was not found: " + statErr.message;

                db.query(`
                    INSERT INTO backup_logs
                    (server_name, backup_type, database_type, status, remarks, backup_location, backup_file_path, triggered_by_username)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    server_name,
                    backup_type,
                    server.database_type,
                    "Failed",
                    truncateForDb(failMessage),
                    backup_path,
                    backupFile,
                    req.user.username
                ]);

                return res.json({
                    success: false,
                    message: failMessage
                });
            }

            db.query(`
                INSERT INTO backup_logs
                (server_name, backup_type, database_type, status, file_size, duration, remarks, backup_location, backup_file_path, triggered_by_username)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                server_name,
                backup_type,
                server.database_type,
                "Completed",
                sizeMB,
                duration,
                "Backup Successful",
                backup_path,
                backupFile,
                req.user.username
            ]);

            db.query(`
                UPDATE servers
                SET
                    last_backup_date = NOW(),
                    last_backup_location = ?,
                    last_backup_duration = ?,
                    last_backup_size = ?,
                    last_backup_remark = ?,
                    last_backup_triggered_by = ?
                WHERE server_name = ?
            `, [backup_path, duration, sizeMB, "Backup Successful", req.user.username, server_name]);

            res.json({
                success: true,
                message: "Backup Created Successfully",
                file: backupFile
            });
        }
    );
});

// ------------------- REPORT STATS -------------------
app.get("/report-stats", verifyToken, (req, res) => {

    const sql = `
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status='Failed' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN status='Running' THEN 1 ELSE 0 END) as running
        FROM backup_logs
    `;

    db.query(sql, (err, result) => {
        if (err) return res.json({ success: false });
        res.json(result[0]);
    });
});

// ------------------- DASHBOARD SUMMARY (Home page) -------------------
// One call for everything the new Home page needs: instance counts
// (total/online/offline) and the 5 most recent backup log rows, so the
// frontend isn't stitching together /servers + /backup-logs + counting
// client-side. Scoped the same way /servers already is - an admin sees
// every instance/backup, a regular user only sees ones assigned to them
// via instance_assignments.
app.get("/dashboard-summary", verifyToken, (req, res) => {

    const isAdmin = req.user.role === "admin";

    const serversSql = isAdmin
        ? "SELECT connection_status FROM servers"
        : `
            SELECT s.connection_status
            FROM servers s
            JOIN instance_assignments ia ON s.id = ia.server_id
            WHERE ia.user_id = ?
        `;

    const serversParams = isAdmin ? [] : [req.user.id];

    db.query(serversSql, serversParams, (serversErr, servers) => {

        if (serversErr) {
            console.log(serversErr);
            return res.json({ success: false, message: "Database Error" });
        }

        const totalInstances = servers.length;
        const online = servers.filter(s => s.connection_status === "Online").length;
        const offline = servers.filter(s => s.connection_status === "Offline").length;

        // Total Backups/Recent Backups: for a non-admin, only backups
        // THEY personally triggered - same reasoning as /backup-logs.
        // (Instance counts above stay scoped to assigned instances,
        // which is a different, correct concept - "instances I can see".)
        const logsSql = isAdmin
            ? "SELECT * FROM backup_logs ORDER BY id DESC"
            : "SELECT * FROM backup_logs WHERE triggered_by_username = ? ORDER BY id DESC";

        const logsParams = isAdmin ? [] : [req.user.username];

        db.query(logsSql, logsParams, (logsErr, logs) => {

            if (logsErr) {
                console.log(logsErr);
                return res.json({ success: false, message: "Database Error" });
            }

            res.json({
                success: true,
                totalInstances,
                online,
                offline,
                totalBackups: logs.length,
                recentBackups: logs.slice(0, 5)
            });

        });

    });

});



// ------------------- UPDATE SERVER -------------------
app.put("/update-server/:id", verifyToken, (req, res) => {

    const {
        server_name,
        ip_address,
        database_type,
        port_number,
        backup_schedule,
        storage,
        status
    } = req.body;

    const sql = `
        UPDATE servers SET
        server_name=?, ip_address=?, database_type=?, port_number=?,
        backup_schedule=?, storage=?, status=?
        WHERE id=?
    `;

    db.query(sql, [
        server_name,
        ip_address,
        database_type,
        port_number,
        backup_schedule,
        storage,
        status,
        req.params.id
    ], (err) => {

        if (err) return res.json({ success: false });
        res.json({ success: true });
    });
});

// ------------------- DELETE SERVER (INSTANCE) -------------------
// Admin only. Deletes the actual servers row (removes it for
// everyone). backup_logs/scheduled_backups store server_name as plain
// text with no foreign key, so backup history is preserved. Blocked
// while a Scheduled backup is pending for this server.
app.delete("/server/:id", verifyToken, verifyAdmin, (req, res) => {

    db.query(
        "SELECT server_name FROM servers WHERE id=?",
        [req.params.id],
        (lookupErr, rows) => {

            if (lookupErr) {
                console.log(lookupErr);
                return res.json({ success: false, message: "Failed to delete instance" });
            }

            if (rows.length === 0) {
                return res.json({ success: false, message: "Instance not found" });
            }

            const serverName = rows[0].server_name;

            db.query(
                "SELECT id FROM scheduled_backups WHERE server_name=? AND status='Scheduled'",
                [serverName],
                (schedErr, scheduled) => {

                    if (schedErr) {
                        console.log(schedErr);
                        return res.json({ success: false, message: "Failed to delete instance" });
                    }

                    if (scheduled.length > 0) {
                        return res.json({
                            success: false,
                            message: "This instance has a pending scheduled backup. Cancel or wait for it to run before deleting."
                        });
                    }

                    db.query(
                        "DELETE FROM servers WHERE id=?",
                        [req.params.id],
                        (err, result) => {

                            if (err) {

                                console.log(err);

                                return res.json({
                                    success: false,
                                    message: "Failed to delete instance"
                                });

                            }

                            if (result.affectedRows === 0) {

                                return res.json({
                                    success: false,
                                    message: "Instance not found"
                                });

                            }

                            res.json({
                                success: true,
                                message: "Instance Deleted Successfully"
                            });

                        }
                    );

                }
            );

        }
    );

});

// ------------------- GET SERVER BY ID -------------------
app.get("/server/:id", verifyToken, (req, res) => {

    db.query("SELECT * FROM servers WHERE id=?", [req.params.id], (err, result) => {
        if (err) return res.json({ success: false });
        res.json(result[0]);
    });
});


app.post("/schedule-backup", verifyToken, (req, res) => {

    const {
        server_name,
        database_type,
        backup_location,
        backup_path,
        backup_type,
        schedule_time
    } = req.body;

    if (!backup_path || !schedule_time) {

        return res.json({
            success: false,
            message: "Backup path and schedule time required"
        });

    }

    // Insert into backup_logs FIRST, with status='Scheduled', so the
    // Reports page shows this backup immediately instead of only
    // after it eventually runs. executeScheduledBackups() later
    // updates this same row (Scheduled -> Running -> Completed/Failed)
    // using the backup_log_id link stored on scheduled_backups below.
    db.query(
        `
        INSERT INTO backup_logs
        (server_name, backup_type, database_type, status, backup_location, triggered_by_username)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
            server_name,
            backup_type,
            database_type,
            "Scheduled",
            backup_location,
            req.user.username
        ],
        (logErr, logResult) => {

            if (logErr) {

                console.log(logErr);

                return res.json({
                    success: false,
                    message: "Database Error"
                });

            }

            const backupLogId = logResult.insertId;

            const sql = `
                INSERT INTO scheduled_backups
                (
                    server_name,
                    database_type,
                    backup_location,
                    backup_path,
                    backup_type,
                    schedule_time,
                    status,
                    backup_log_id,
                    triggered_by_username
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.query(
                sql,
                [
                    server_name,
                    database_type,
                    backup_location,
                    backup_path,
                    backup_type,
                    schedule_time,
                    "Scheduled",
                    backupLogId,
                    req.user.username
                ],
                (err) => {

                    if (err) {

                        console.log(err);

                        // The backup_logs row was already created above;
                        // mark it Failed rather than leaving an orphaned
                        // "Scheduled" row with no matching schedule.
                        db.query(
                            "UPDATE backup_logs SET status='Failed', remarks=? WHERE id=?",
                            ["Failed to create schedule", backupLogId]
                        );

                        return res.json({
                            success: false,
                            message: "Database Error"
                        });

                    }

                    res.json({
                        success: true,
                        message: "Backup Scheduled Successfully"
                    });

                }
            );

        }
    );

});



// ------------------- LOGIN -------------------
app.post("/login", (req, res) => {

    const { username, password } = req.body;

    const sql = "SELECT * FROM admin_users WHERE username=?";

    db.query(sql, [username], async (err, result) => {

        if (err) return res.json({ success: false, message: "DB error" });

        if (result.length === 0) {
            return res.json({ success: false, message: "User not found" });
        }

        const user = result[0];

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.json({ success: false, message: "Invalid password" });
        }

        const token = jwt.sign(
            {
                id: user.id,
                role: user.role,
                username: user.username
            },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        res.json({
            success: true,
            token,
            role: user.role
        }); 
    });
});

function verifyAdmin(
    req,
    res,
    next
){

    if(req.user.role !== "admin"){

        return res.json({
            success:false,
            message:"Admin Access Only"
        });

    }

    next();

}

// ------------------- CONNECTION CHECK -------------------
app.post("/check-connection", verifyToken, (req, res) => {

    const { ip_address, port_number } = req.body;

    const socket = new net.Socket();

    socket.setTimeout(3000);

    socket.connect(port_number, ip_address, () => {
        socket.destroy();
        res.json({ success: true, message: "Connection Successful" });
    });

    socket.on("error", () => {
        res.json({ success: false, message: "Connection Failed" });
    });

    socket.on("timeout", () => {
        socket.destroy();
        res.json({ success: false, message: "Connection Timeout" });
    });
});

///////////////////////////////////////////////////////
// REAL TIME INSTANCE MONITORING
///////////////////////////////////////////////////////

function monitorInstances() {

    db.query(
        "SELECT * FROM servers",
        (err, servers) => {

            if (err) {
                console.log(err);
                return;
            }

            servers.forEach(server => {

    if (
        !server.ip_address ||
        !server.port_number
    ) {

        console.log(
            `Skipping ${server.server_name} - Missing IP/Port`
        );

        return;
    }

    const startTime = Date.now();

    const socket = new net.Socket();

    socket.setTimeout(3000);

    socket.connect(
        Number(server.port_number),
        server.ip_address,
        () => {

                        const responseTime =
                            Date.now() - startTime;

                        socket.destroy();

                        db.query(
                            `
                            UPDATE servers
                            SET
                                connection_status='Online',
                                response_time_ms=?,
                                last_checked_time=NOW()
                            WHERE id=?
                            `,
                            [
                                responseTime,
                                server.id
                            ]
                        );

                    }
                );

                socket.on("error", () => {

                    db.query(
                        `
                        UPDATE servers
                        SET
                            connection_status='Offline',
                            last_down_time=NOW(),
                            last_checked_time=NOW()
                        WHERE id=?
                        `,
                        [server.id]
                    );

                });

                socket.on("timeout", () => {

                    socket.destroy();

                    db.query(
                        `
                        UPDATE servers
                        SET
                            connection_status='Offline',
                            last_down_time=NOW(),
                            last_checked_time=NOW()
                        WHERE id=?
                        `,
                        [server.id]
                    );

                });

            });

        }
    );

}

// Run immediately on startup
monitorInstances();

// Run every 60 seconds
setInterval(monitorInstances, 60000);

///////////////////////////////////////////////////////
// SCHEDULED BACKUPS (cron - runs once per minute)
///////////////////////////////////////////////////////

function executeScheduledBackups() {

    db.query(
        "SELECT * FROM scheduled_backups WHERE status='Scheduled'",
        (err, backups) => {

            if (err) {
                console.log(err);
                return;

            }

            backups.forEach(backup => {

                const now = new Date();

                const scheduleTime =
                    new Date(backup.schedule_time);

                if (now >= scheduleTime) {

    db.query(
        "SELECT * FROM servers WHERE server_name=?",
        [backup.server_name],
        async (err, result) => {

            if (err || result.length === 0) {

                console.log("Server not found");

                db.query(
                    `UPDATE scheduled_backups
                     SET status='Failed'
                     WHERE id=?`,
                    [backup.id]
                );

                if (backup.backup_log_id) {
                    db.query(
                        `UPDATE backup_logs
                         SET status='Failed', remarks=?
                         WHERE id=?`,
                        ["Server not found", backup.backup_log_id]
                    );
                }

                return;
            }

            const server = result[0];

            console.log(
                "Executing Scheduled Backup:",
                backup.server_name
            );

            // Flip the linked backup_logs row to "Running" right before
            // actually executing, so the Reports page reflects what's
            // happening in real time instead of jumping straight from
            // "Scheduled" to "Completed" with no visible in-progress state.
            if (backup.backup_log_id) {
                db.query(
                    `UPDATE backup_logs SET status='Running' WHERE id=?`,
                    [backup.backup_log_id]
                );
            }

            const startTime = Date.now();

            // Routes to the MySQL or Oracle branch based on
            // server.database_type - this is the fix: previously
            // this always built a mysqldump command regardless of
            // database_type, so scheduled Oracle backups always
            // failed with a MySQL connection error.
            const backupResult = await runDatabaseBackup(
                server,
                backup.server_name,
                backup.backup_path
            );

            if (!backupResult.success) {

                console.log(backupResult.message);

                db.query(
                    `UPDATE scheduled_backups
                     SET status='Failed'
                     WHERE id=?`,
                    [backup.id]
                );

                if (backup.backup_log_id) {
                    db.query(
                        `UPDATE backup_logs
                         SET status='Failed', remarks=?
                         WHERE id=?`,
                        [truncateForDb(backupResult.message) || "Scheduled backup failed", backup.backup_log_id]
                    );
                }

                return;
            }

            // This part was missing before: a successful scheduled
            // backup updated backup_logs and scheduled_backups, but
            // never touched the servers table - so the Instance
            // Details panel's Last Backup Date/Duration/Size/Location
            // never reflected scheduled runs, only immediate
            // "Backup Now" ones. Mirror the same UPDATE that
            // "/start-backup" does so both paths keep servers in sync.

            const endTime = Date.now();
            const duration = ((endTime - startTime) / 1000).toFixed(2) + " sec";

            let sizeMB = "Unknown";
            try {
                const stats = fs.statSync(backupResult.backupFile);
                sizeMB = formatFileSize(stats.size);
            } catch (statErr) {
                console.log(
                    "Could not read backup file size:",
                    statErr.message
                );
            }

            // UPDATE the same backup_logs row created when this backup
            // was scheduled (Scheduled -> Running -> Completed), instead
            // of inserting a brand new row - this is what makes the
            // scheduled backup show up in Reports immediately on
            // scheduling, then update live as it runs and completes.
            if (backup.backup_log_id) {

                db.query(
                    `
                    UPDATE backup_logs
                    SET
                        status = 'Completed',
                        file_size = ?,
                        duration = ?,
                        remarks = ?,
                        backup_location = ?,
                        backup_file_path = ?
                    WHERE id = ?
                    `,
                    [
                        sizeMB,
                        duration,
                        "Scheduled Backup Successful",
                        backup.backup_path,
                        backupResult.backupFile,
                        backup.backup_log_id
                    ]
                );

            } else {

                // Fallback for any pre-existing scheduled_backups rows
                // created before backup_log_id existed - insert a new
                // log row rather than silently losing the record.
                db.query(
                    `
                    INSERT INTO backup_logs
                    (
                        server_name,
                        backup_type,
                        database_type,
                        status,
                        file_size,
                        duration,
                        remarks,
                        backup_location,
                        backup_file_path
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                    [
                        backup.server_name,
                        backup.backup_type,
                        server.database_type,
                        "Completed",
                        sizeMB,
                        duration,
                        "Scheduled Backup Successful",
                        backup.backup_path,
                        backupResult.backupFile
                    ]
                );

            }

            db.query(
                `
                UPDATE servers
                SET
                    last_backup_date = NOW(),
                    last_backup_location = ?,
                    last_backup_duration = ?,
                    last_backup_size = ?,
                    last_backup_remark = ?,
                    last_backup_triggered_by = ?
                WHERE server_name = ?
                `,
                [
                    backup.backup_path,
                    duration,
                    sizeMB,
                    "Scheduled Backup Successful",
                    backup.triggered_by_username,
                    backup.server_name
                ],
                (updateErr, updateResult) => {

                    if (updateErr) {

                        console.log(
                            "FAILED to update servers table for scheduled backup:",
                            updateErr
                        );

                    } else {

                        console.log(
                            `servers table update for "${backup.server_name}" -> affectedRows: ${updateResult.affectedRows}`
                        );

                    }

                }
            );

            db.query(
                `
                UPDATE scheduled_backups
                SET status='Completed'
                WHERE id=?
                `,
                [backup.id]
            );

            console.log("Scheduled Backup Completed");

        }
    );

                }

            });

        }
    );

}


cron.schedule("* * * * *", () => {

    executeScheduledBackups();

});

// ------------------- START SERVER -------------------
app.listen(3000, () => {
    console.log("Server Running on Port 3000");
});



//assigning instance to users
app.post(
    "/assign-instance",
    verifyToken,
    verifyAdmin,
    (req, res) => {

        const {
            user_id,
            server_id
        } = req.body;

        db.query(
            `
            INSERT INTO instance_assignments
            (
                user_id,
                server_id,
                assigned_by
            )
            VALUES (?, ?, ?)
            `,
            [
                user_id,
                server_id,
                req.user.id
            ],
            (err) => {

                if (err) {

                    console.log(err);

                    return res.json({
                        success: false,
                        message: "Assignment Failed"
                    });

                }

                res.json({
                    success: true,
                    message: "Assigned Successfully"
                });

            }
        );

    }
);



//dropdown for manage users
app.get(
    "/users",
    verifyToken,
    verifyAdmin,
    (req, res) => {

        db.query(
            `
            SELECT id, username
            FROM admin_users
            WHERE role='user'
            `,
            (err, result) => {

                if (err) {
                    return res.json([]);
                }

                res.json(result);

            }
        );

    }
);

app.get(
    "/all-servers",
    verifyToken,
    verifyAdmin,
    (req, res) => {

        db.query(
            `
            SELECT id, server_name
            FROM servers
            ORDER BY server_name
            `,
            (err, result) => {

                if (err) {
                    console.log(err);
                    return res.json([]);
                }

                res.json(result);

            }
        );

    }
);


app.get(
    "/assigned-instances/:userId",
    verifyToken,
    verifyAdmin,
    (req, res) => {

        const userId = req.params.userId;

        db.query(
            `
            SELECT
                s.id,
                s.server_name
            FROM servers s
            JOIN instance_assignments ia
                ON s.id = ia.server_id
            WHERE ia.user_id = ?
            `,
            [userId],
            (err, result) => {

                if (err) {
                    console.log(err);
                    return res.json([]);
                }

                res.json(result);
            }
        );
    }
);

app.get(
    "/available-instances/:userId",
    verifyToken,
    verifyAdmin,
    (req, res) => {

        const userId = req.params.userId;

        db.query(
            `
            SELECT
                id,
                server_name
            FROM servers
            WHERE id NOT IN
            (
                SELECT server_id
                FROM instance_assignments
                WHERE user_id = ?
            )
            ORDER BY server_name
            `,
            [userId],
            (err, result) => {

                if (err) {
                    console.log(err);
                    return res.json([]);
                }

                res.json(result);

            }
        );

    }
);

app.delete(
    "/remove-instance-access",
    verifyToken,
    verifyAdmin,
    (req, res) => {

        const { user_id, server_id } = req.body;

        db.query(
            `
            DELETE FROM instance_assignments
            WHERE user_id = ?
            AND server_id = ?
            `,
            [user_id, server_id],
            (err, result) => {

                if (err) {

                    console.log(err);

                    return res.json({
                        success: false,
                        message: err.message
                    });

                }

                res.json({
                    success: true,
                    message: "Access Removed Successfully"
                });

            }
        );

    }
);