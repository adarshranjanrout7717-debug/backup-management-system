/////////////////////////////////////////////////////////
// 🔐 SECURITY CHECK (JWT instead of loggedIn flag)
/////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////
// JWT AUTH CHECK
/////////////////////////////////////////////////////////

const token = localStorage.getItem("token");

if (!token) {
    window.location.replace("login.html");
}

function handleUnauthorized(data) {

    if (
        data.message === "Invalid token" ||
        data.message === "No token provided" ||
        data.message === "Token expired or invalid"
    ) {

        localStorage.removeItem("token");
        localStorage.removeItem("role");

        alert("Session expired. Please login again.");

        window.location.replace("login.html");
    }
}

let selectedServerId = null;

/////////////////////////////////////////////////////////
// TAB SWITCHING
/////////////////////////////////////////////////////////

function showTab(tabId) {

    document.getElementById("homeTab").style.display = "none";
    document.getElementById("instanceTab").style.display = "none";
    document.getElementById("logsTab").style.display = "none";

    document.getElementById(tabId).style.display = "block";
}

/////////////////////////////////////////////////////////
// LOGOUT
/////////////////////////////////////////////////////////

function logout() {

    localStorage.removeItem("token");
    localStorage.removeItem("role");

    window.location.replace("login.html");
}

/////////////////////////////////////////////////////////
// LOAD SERVERS
/////////////////////////////////////////////////////////

async function loadServers() {

    try {

        const response = await fetch(
            "http://localhost:3000/servers",
            {
                headers: {
                    Authorization: "Bearer " + token
                }
            }
        );

        const servers = await response.json();

        handleUnauthorized(servers);

        if (!Array.isArray(servers)) {
            return;
        }

        let html = "";

        servers.forEach(server => {

            html += `
                <div class="card mb-2">

                    <div class="card-body">

                       <h6>${server.server_name}</h6>

<small>
IP: ${server.ip_address}
</small>

<br>

<small>
Port: ${server.port_number}
</small>

<br>

<small>
DB: ${server.database_type}
</small>

<br>

<small>
Response:
${server.response_time_ms || "-"} ms
</small>

<br>

<small>
Last Check:
${server.last_checked_time || "-"}
</small>

<br>

<span class="badge ${
    server.connection_status === "Online"
        ? "bg-success"
        : "bg-danger"
}">
    ${server.connection_status}
</span> 

                        <br>

                        <button
                            class="btn btn-sm btn-primary mt-2"
                            onclick="loadServerDetails(${server.id})">

                            View

                        </button>

                    </div>

                </div>
            `;
        });

        document.getElementById("instanceList").innerHTML = html;

    } catch (error) {

        console.log(error);

    }
}

/////////////////////////////////////////////////////////
// LOAD SERVER DETAILS
/////////////////////////////////////////////////////////

async function loadServerDetails(id) {

    selectedServerId = id;

    try {

        const response = await fetch(
            `http://localhost:3000/server/${id}`,
            {
                headers: {
                    Authorization: "Bearer " + token
                }
            }
        );

        const server = await response.json();

        handleUnauthorized(server);

        document.getElementById("instanceName").value =
            server.server_name || "";

        document.getElementById("databaseType").value =
            server.database_type || "";

        document.getElementById("instanceIp").value =
            server.ip_address || "";

        document.getElementById("instanceStatus").value =
            server.status || "";

        document.getElementById("lastBackupDate").value =
            server.last_backup_date || "";
         
        document.getElementById("lastDownTime").value =
            server.last_down_time || "";

        document.getElementById("lastBackupLocation").value =
            server.last_backup_location || "";

        document.getElementById("backupDuration").value =
            server.last_backup_duration || "";

        document.getElementById("backupSize").value =
            server.last_backup_size || "";

        document.getElementById("backupRemark").value =
            server.last_backup_remark || "";

    } catch (error) {

        console.log(error);

    }
}

/////////////////////////////////////////////////////////
// ADD SERVER
/////////////////////////////////////////////////////////

async function addServer() {

    const server_name =
        document.getElementById("serverName").value;

    const database_type =
        document.getElementById("databaseTypeInput").value;

    const ip_address =
        document.getElementById("ipAddress").value;

    const port_number =
        document.getElementById("portNumber").value;
     
    const db_name =
        document.getElementById("dbName").value;

    const db_username =
        document.getElementById("dbUsername").value;

    const db_password =
        document.getElementById("dbPassword").value;    

    try {

        const response = await fetch(
            "http://localhost:3000/add-server",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token
                },
                body: JSON.stringify({
                    server_name,
                    database_type,
                    ip_address,
                    port_number,
                    db_name,
                    db_username,
                    db_password,

                    status: "Active"
                })
            }
        );

        const data = await response.json();

        handleUnauthorized(data);

        if (data.success) {

            alert("Instance Added Successfully");

            loadServers();

            showTab("homeTab");

        } else {

            alert(data.message || "Failed To Add Instance");

        }

    } catch (error) {

        console.log(error);

    }
}

/////////////////////////////////////////////////////////
// LOAD LOGS
/////////////////////////////////////////////////////////

async function loadLogs() {

    try {

        const response = await fetch(
            "http://localhost:3000/backup-logs",
            {
                headers: {
                    Authorization: "Bearer " + token
                }
            }
        );

        const logs = await response.json();

        handleUnauthorized(logs);

        if (!Array.isArray(logs)) {
            return;
        }

        let html = "";

        logs.forEach(log => {

            html += `
                <tr>

                    <td>${log.id}</td>

                    <td>${log.server_name}</td>

                    <td>${log.backup_type}</td>

                    <td>${log.status}</td>

                    <td>${log.progress}%</td>

                </tr>
            `;
        });

        document.getElementById("logsContainer").innerHTML = html;

    } catch (error) {

        console.log(error);

    }
}

/////////////////////////////////////////////////////////
// SCHEDULE BACKUP
/////////////////////////////////////////////////////////

async function scheduleBackup() {

    if (!selectedServerId) {

        alert("Select an Instance First");
        return;
    }

    const server_name =
        document.getElementById("instanceName").value;

    const database_type =
        document.getElementById("databaseType").value;

    const backup_location =
        document.getElementById("scheduleLocation").value;

    const backup_path =
        document.getElementById("schedulePath").value;

    const schedule_time =
        document.getElementById("scheduleTime").value;

    const response = await fetch(
        "http://localhost:3000/schedule-backup",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
                server_name,
                database_type,
                backup_location,
                backup_path,
                backup_type: "Full Backup",
                schedule_time
            })
        }
    );

    const data = await response.json();

    if (data.success) {

        alert("Backup Scheduled Successfully");

    } else {

        alert(data.message);

    }

}

/////////////////////////////////////////////////////////
// BACKUP NOW
/////////////////////////////////////////////////////////

async function startBackup() {

    if (!selectedServerId) {

        alert("Select an Instance First");

        return;
    }

    const server_name =
        document.getElementById("instanceName").value;

    const backup_location =
        document.getElementById("backupLocation").value;

    const backup_path =
        document.getElementById("backupPath").value;

    if (!backup_path) {

        alert("Enter Backup Path");

        return;
    }

    const response = await fetch(
        "http://localhost:3000/start-backup",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token
            },
            body: JSON.stringify({
                server_name,
                backup_type: "Full Backup",
                backup_location,
                backup_path
            })
        }
    );

    const data = await response.json();

    handleUnauthorized(data);

    if (data.success) {

        alert(
            "Backup Created Successfully\n\n" +
            data.file
        );

        loadLogs();

    } else {

        alert(data.message);

    }
}

/////////////////////////////////////////////////////////
// CHECK CONNECTION
/////////////////////////////////////////////////////////

async function checkConnection() {

    const ip_address =
        document.getElementById("ipAddress").value;

    const port_number =
        document.getElementById("portNumber").value;

    if (!ip_address || !port_number) {

        alert("Enter IP Address and Port Number");

        return;
    }

    try {

        const response = await fetch(
            "http://localhost:3000/check-connection",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token
                },
                body: JSON.stringify({
                    ip_address,
                    port_number
                })
            }
        );

        const data = await response.json();

        handleUnauthorized(data);

        if (data.success) {

            alert("✅ Connection Successful");

        } else {

            alert("❌ " + data.message);

        }

    } catch (error) {

        console.log(error);

        alert("Connection Test Failed");
    }
}

/////////////////////////////////////////////////////////
// INITIAL LOAD
/////////////////////////////////////////////////////////

loadServers();
loadLogs();

/////////////////////////////////////////////////////////
// AUTO REFRESH
/////////////////////////////////////////////////////////

setInterval(() => {

    loadServers();
    loadLogs();

}, 10000);