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
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "Ritikdas@378",
    database: "test",
});

db.connect((err) => {
    if (err) {
        console.log("Database Connection Failed");
        console.log(err);
    } else {
        console.log("Database Connected Successfully");
    }
});

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
    (req, res) => {

        if (req.user.role === "admin") {

            db.query(
                "SELECT * FROM servers",
                (err, result) => {
                    res.json(result);
                });

        }
        else {

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
                (err, result) => {

                    res.json(result);

                });

        }

    });

app.post("/add-server", verifyToken, (req, res) => {

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

    // Duplicate Check

    const checkSql = `
        SELECT id
        FROM servers
        WHERE server_name = ?
        OR (ip_address = ? AND port_number = ?)
    `;

    db.query(
        checkSql,
        [
            server_name,
            ip_address,
            port_number
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

    db.query("SELECT * FROM backup_logs ORDER BY id DESC", (err, result) => {
        if (err) return res.json([]);
        res.json(result);
    });
});

// ------------------- START BACKUP -------------------
// app.post("/start-backup", verifyToken, (req, res) => {

//     console.log("START BACKUP CLICKED");

//     const {
//         server_name,
//         backup_type,
//         backup_location,
//         backup_path
//     } = req.body;

//     db.query(
//         "SELECT * FROM servers WHERE server_name=?",
//         [server_name],
//         async (err, result) => {

//             if (err || result.length === 0) {
//                 return res.json({
//                     success: false,
//                     message: "Server not found"
//                 });
//             }

//             const server = result[0];

//             if (!backup_path) {
//                 return res.json({ success: false, message: "Backup Path Required" });
//             }

//             try {
//                 if (!fs.existsSync(backup_path)) {
//                     fs.mkdirSync(backup_path, { recursive: true });
//                 }
//             } catch (err) {
//                 return res.json({ success: false, message: err.message });
//             }

//             const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
//             const startTime = Date.now();

//             // ============================================================
//             // MYSQL BRANCH (unchanged from your existing code)
//             // ============================================================
//             if (server.database_type === "MySQL") {

//                 const backupFile = path.join(
//                     backup_path,
//                     `${server_name}_${timestamp}.sql`
//                 );

//                 // 🔐 safer file handling
//                 const command =
//                     `"C:\\Program Files\\MySQL\\MySQL Server 9.6\\bin\\mysqldump.exe" --no-tablespaces -h ${server.ip_address} -P ${server.port_number} -u ${server.db_username} -p${server.db_password} ${server.db_name} > "${backupFile}"`;

//                 console.log("Backup File:", backupFile);
//                 console.log("Command:", command);

//                 exec(command, (error) => {

//                     if (error) {
//                         console.log(error);
//                         return res.json({
//                             success: false,
//                             message: error.message
//                         });
//                     }

//                     finishBackup(backupFile);
//                 });

//             }

//             // ============================================================
//             // ORACLE BRANCH (new)
//             // ============================================================
//             else if (server.database_type === "Oracle") {

//                 // On this machine, the Oracle Windows service (NT SERVICE\OracleServiceXE)
//                 // cannot see/write to drives other than C:\ — confirmed by testing.
//                 // Reject other drives early with a clear message instead of letting
//                 // it fail deep inside expdp with a confusing ORA-29283 error.
//                 if (!/^[Cc]:\\/.test(backup_path)) {
//                     return res.json({
//                         success: false,
//                         message: "Oracle backups on this server must use a path on the C: drive (e.g. C:\\RBMS_BACKUPS). The D: drive is not accessible to the Oracle service."
//                     });
//                 }

//                 // Oracle dump files must end in .dmp, not .sql
//                 const dumpFileName = `${server_name}_${timestamp}.dmp`;
//                 const logFileName = `${server_name}_${timestamp}.log`;
//                 const backupFile = path.join(backup_path, dumpFileName);

//                 // Oracle needs a DIRECTORY OBJECT inside the database that
//                 // points at backup_path before expdp can write there.
//                 // We create/replace it fresh every time so it always matches
//                 // whatever backup_path the user picked.
//                 const directoryName = "DPUMP_DYNAMIC_DIR";

//                 try {
//                     // 1. Connect to the customer's Oracle DB to set up the directory object
//                     const connection = await oracledb.getConnection({
//                         user: server.db_username,
//                         password: server.db_password,
//                         connectString: `${server.ip_address}:${server.port_number}/${server.db_name}`
//                     });

//                     await connection.execute(
//                         `CREATE OR REPLACE DIRECTORY ${directoryName} AS '${backup_path}'`
//                     );

//                     // No GRANT needed here: the same user that creates the
//                     // directory is the one using it, and Oracle doesn't
//                     // allow (or need) granting a privilege to yourself.
//                     // If you ever connect as a different DBA user to set
//                     // this up on behalf of server.db_username, add the
//                     // GRANT back in at that point.

//                     await connection.commit();
//                     await connection.close();

//                 } catch (oraErr) {
//                     console.log(oraErr);
//                     return res.json({
//                         success: false,
//                         message: "Failed to prepare Oracle directory: " + oraErr.message
//                     });
//                 }

//                 // 2. Now run expdp referencing that directory object (not the raw path)
//                 const connectString = `//${server.ip_address}:${server.port_number}/${server.db_name}`;

//                 const command =
//                     `expdp ${server.db_username}/${server.db_password}@${connectString} ` +
//                     `DIRECTORY=${directoryName} DUMPFILE=${dumpFileName} LOGFILE=${logFileName} ` +
//                     `SCHEMAS=${server.db_username}`;

//                 console.log("Backup File:", backupFile);
//                 console.log("Command:", command.replace(server.db_password, "********"));

//                 exec(command, (error) => {

//                     // expdp can return a non-zero exit code even on partial
//                     // success/warnings, so check the actual file instead of
//                     // trusting `error` alone.
//                     if (error && !fs.existsSync(backupFile)) {
//                         console.log(error);
//                         return res.json({
//                             success: false,
//                             message: error.message
//                         });
//                     }

//                     finishBackup(backupFile);
//                 });

//             }

//             // ============================================================
//             // UNKNOWN DATABASE TYPE
//             // ============================================================
//             else {
//                 return res.json({
//                     success: false,
//                     message: `Unsupported database type: ${server.database_type}`
//                 });
//             }

//             // ============================================================
//             // SHARED COMPLETION LOGIC (logging + DB updates)
//             // ============================================================
//             function finishBackup(backupFile) {

//                 const endTime = Date.now();
//                 const duration = ((endTime - startTime) / 1000).toFixed(2) + " sec";

//                 let sizeMB;
//                 try {
//                     const stats = fs.statSync(backupFile);
//                     sizeMB = (stats.size / 1024 / 1024).toFixed(2) + " MB";
//                 } catch (statErr) {
//                     return res.json({
//                         success: false,
//                         message: "Backup command ran but output file was not found: " + statErr.message
//                     });
//                 }

//                 db.query(`
//                     INSERT INTO backup_logs
//                     (server_name, backup_type, status, progress)
//                     VALUES (?, ?, ?, ?)
//                 `, [server_name, backup_type, "Completed", 100]);

//                 db.query(`
//                     UPDATE servers
//                     SET
//                         last_backup_date = NOW(),
//                         last_backup_location = ?,
//                         last_backup_duration = ?,
//                         last_backup_size = ?,
//                         last_backup_remark = ?
//                     WHERE server_name = ?
//                 `, [backup_path, duration, sizeMB, "Backup Successful", server_name]);

//                 res.json({
//                     success: true,
//                     message: "Backup Created Successfully",
//                     file: backupFile
//                 });
//             }
//         }
//     );
// });
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
        (err, result) => {

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

            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

            const backupFile = path.join(
                backup_path,
                `${server_name}_${timestamp}.sql`
            );

            // 🔐 safer file handling

            const command =
                `"C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe" --no-tablespaces -h ${server.ip_address} -P ${server.port_number} -u ${server.db_username} -p${server.db_password} ${server.db_name} > "${backupFile}"`;

            const startTime = Date.now();

            console.log("Backup File:", backupFile);
            console.log("Command:", command);

            exec(command, (error) => {

                if (error) {

                    console.log(error);

                    let msg = "Backup Failed";

                    if (error.message.includes("10060")) {
                        msg = "Instance is unreachable. Please check the IP address or network connection.";
                    }
                    else if (error.message.includes("1045")) {
                        msg = "Invalid database username or password.";
                    }
                    else if (error.message.includes("1130")) {
                        msg = "Remote connections are not allowed for this MySQL server.";
                    }
                    else if (error.message.includes("1044")) {
                        msg = "Database access denied.";
                    }

                    return res.json({
                        success: false,
                        message: msg
                    });
                }

                const endTime = Date.now();

                const duration =
                    ((endTime - startTime) / 1000).toFixed(2) + " sec";

                const stats = fs.statSync(backupFile);

                const sizeMB =
                    (stats.size / 1024 / 1024).toFixed(2) + " MB";

                db.query(`
    INSERT INTO backup_logs
    (
        server_name,
        backup_type,
        status,
        progress
    )
    VALUES (?, ?, ?, ?)
`,
                    [
                        server_name,
                        backup_type,
                        "Completed",
                        100
                    ]);

                db.query(
                    `
UPDATE servers
SET
    last_backup_date = NOW(),
    last_backup_location = ?,
    last_backup_duration = ?,
    last_backup_size = ?,
    last_backup_remark = ?
WHERE server_name = ?
`,
                    [
                        backup_path,
                        duration,
                        sizeMB,
                        "Backup Successful",
                        server_name
                    ]
                );

                res.json({
                    success: true,
                    message: "Backup Created Successfully",
                    file: backupFile
                });
            });
        });
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
app.get("/backup-report", verifyToken, (req, res) => {

    db.query(
        `SELECT
            server_name,
            backup_type,
            status,
            progress,
            created_at
        FROM backup_logs
        ORDER BY created_at DESC`,
        (err, result) => {

            if (err) {
                return res.json({
                    success: false
                });
            }

            res.json(result);
        }
    );

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

    const sql = `
        INSERT INTO scheduled_backups
        (
            server_name,
            database_type,
            backup_location,
            backup_path,
            backup_type,
            schedule_time,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
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
            "Scheduled"
        ],
        (err) => {

            if (err) {

                console.log(err);

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
                role: user.role
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
) {

    if (req.user.role !== "admin") {

        return res.json({
            success: false,
            message: "Admin Access Only"
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


cron.schedule("* * * * *", () => {

    executeScheduledBackups();

});
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
                        (err, result) => {

                            if (err || result.length === 0) {

                                console.log("Server not found");

                                db.query(
                                    `UPDATE scheduled_backups
                     SET status='Failed'
                     WHERE id=?`,
                                    [backup.id]
                                );

                                return;
                            }

                            const server = result[0];

                            console.log(
                                "Executing Scheduled Backup:",
                                backup.server_name
                            );

                            const timestamp =
                                new Date()
                                    .toISOString()
                                    .replace(/[:.]/g, "-");

                            const backupFile =
                                path.join(
                                    backup.backup_path,
                                    `${backup.server_name}_${timestamp}.sql`
                                );

                            const command =
                                `"C:\\Program Files\\MySQL\\MySQL Server 9.6\\bin\\mysqldump.exe" --no-tablespaces -h ${server.ip_address} -P ${server.port_number} -u ${server.db_username} -p${server.db_password} ${server.db_name} > "${backupFile}"`;

                            console.log("Command:", command);

                            exec(command, (error) => {

                                if (error) {

                                    console.log(error);

                                    db.query(
                                        `UPDATE scheduled_backups
                         SET status='Failed'
                         WHERE id=?`,
                                        [backup.id]
                                    );

                                    return;
                                }

                                db.query(
                                    `
                    INSERT INTO backup_logs
                    (
                        server_name,
                        backup_type,
                        status,
                        progress
                    )
                    VALUES (?, ?, ?, ?)
                    `,
                                    [
                                        backup.server_name,
                                        backup.backup_type,
                                        "Completed",
                                        100
                                    ]
                                );

                                db.query(
                                    `
                    UPDATE scheduled_backups
                    SET status='Completed'
                    WHERE id=?
                    `,
                                    [backup.id]
                                );

                                console.log(
                                    "Scheduled Backup Completed"
                                );

                            });

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

// async function getOracleConnection() {

//     return await oracledb.getConnection({
//         user: "test_oracle_db",
//         password: "test123",
//         connectString: "10.180.23.82:1521/XEPDB1"
//     });

// }



// //------------------- Oracle connection block -------------------


// async function test() {
//     const conn = await oracledb.getConnection({
//         user: "test_oracle_db",
//         password: "test123",
//         connectString: "10.180.23.82:1521/XEPDB1"
//     });

//     console.log("Connected");
//     await conn.close();
// }

// test();

// //------------------- oracle route -------------------
// app.get("/oracle-test", async (req, res) => {

//     let conn;

//     try {

//         conn = await getOracleConnection();

//         const result = await conn.execute(
//             "SELECT * FROM EMPLOYEES",
//             [],
//             {
//                 outFormat: oracledb.OUT_FORMAT_OBJECT
//             }
//         );

//         res.json(result.rows);

//     } catch (err) {

//         console.log(err);
//         res.status(500).send(err.message);

//     } finally {

//         if (conn) {
//             await conn.close();
//         }

//     }

// });