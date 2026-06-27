window.addEventListener("pageshow", function () {

    if (!localStorage.getItem("token")) {
        window.location.href = "login.html";
    }

});
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

function showTab(tabId, pushState = true) {

    const role = localStorage.getItem("role");

    if (
        tabId === "usersTab" &&
        role !== "admin"
    ) {
        alert("Access Denied");
        return;
    }

    const tabs = [
        "homeTab",
        "reportsTab",
        "usersTab"
    ];

    tabs.forEach(id => {

        const el = document.getElementById(id);

        if (el) {
            el.style.display = "none";
        }

    });

    document.getElementById(tabId).style.display = "block";
    if (pushState) {
        history.pushState(
            { tab: tabId },
            "",
            "#" + tabId
        );
    }

    // LOAD DROPDOWNS
    if (tabId === "usersTab") {

        const userSelect =
            document.getElementById("userSelect");

        if (userSelect.options.length <= 1) {
            loadUsers();
        }

    }
    // Update active navigation tab
    document.querySelectorAll(".nav-tabs .nav-link").forEach(btn => {
        btn.classList.remove("active");
    });

    const activeBtn = document.querySelector(
        `.nav-link[onclick="showTab('${tabId}')"]`
    );

    if (activeBtn) {
        activeBtn.classList.add("active");
    }

    //new
    if (tabId === "reportsTab") {
        loadReportStats();
        loadReportTable();
    }
}

/////////////////////////////////////////////////////////
// LOGOUT
/////////////////////////////////////////////////////////

function logout() {

    //updated
    localStorage.clear();
    sessionStorage.clear();

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
    <div class="instance-card ${selectedServerId === server.id ? 'active-instance' : ''}"
         id="instance-${server.id}"
         onclick="selectInstance(${server.id})">

        <div class="d-flex justify-content-between align-items-center">

            <div>

                <div class="server-name">
                    ${server.server_name}
                </div>

                <div class="server-ip">
                    IP: ${server.ip_address}
                </div>

                <div class="server-db">
                    DB: ${server.database_type}
                </div>

            </div>

            <div>
                ${server.connection_status === "Online"
                    ? '<span class="text-success">●</span>'
                    : '<span class="text-danger">●</span>'
                }
            </div>

        </div>

    </div>
    `;

        });

        document.getElementById("instanceList").innerHTML = html;

    } catch (error) {

        console.log(error);

    }
}


function selectInstance(id) {

    selectedServerId = id;

    loadServerDetails(id);

    document.querySelectorAll(".instance-card").forEach(card => {
        card.classList.remove("active-instance");
    });

    const selectedCard = document.getElementById(`instance-${id}`);

    if (selectedCard) {
        selectedCard.classList.add("active-instance");
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

            const modal =
                bootstrap.Modal.getInstance(
                    document.getElementById("addInstanceModal")
                );

            modal.hide();

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
        loadReportStats();
        loadReportTable();

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


//assign instance function
async function assignInstance() {

    const token = localStorage.getItem("token");

    const user_id =
        document.getElementById("userSelect").value;

    const server_id =
        document.getElementById("instanceSelect").value;

    const res = await fetch(
        "http://localhost:3000/assign-instance",
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },

            body: JSON.stringify({
                user_id,
                server_id
            })
        }
    );

    const data = await res.json();

    //UPDATED
    if (data.success) {

        alert("Instance Assigned Successfully");

        loadAssignedInstances();

        loadInstancesForAssign();

    }
}

async function denyInstanceAccess(userId, serverId) {

    if (!confirm("Remove access to this instance?")) {
        return;
    }

    const token =
        localStorage.getItem("token");

    const res = await fetch(
        "http://localhost:3000/remove-instance-access",
        {
            method: "DELETE",

            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token
            },

            body: JSON.stringify({
                user_id: userId,
                server_id: serverId
            })
        }
    );

    const data = await res.json();

    if (data.success) {

        alert("Access Removed Successfully");

        loadAssignedInstances();

        loadInstancesForAssign();

    } else {

        alert(data.message || "Failed to remove access");

    }
}

async function loadUsers() {

    const token = localStorage.getItem("token");

    const res = await fetch(
        "http://localhost:3000/users",
        {
            headers: {
                Authorization: "Bearer " + token
            }
        }
    );

    const users = await res.json();

    const select =
        document.getElementById("userSelect");

    select.innerHTML = `
        <option value="">
            Select User
        </option>
    `;

    users.forEach(user => {

        select.innerHTML += `
            <option value="${user.id}">
                ${user.username}
            </option>
        `;

    });

    // Clear table initially
    document.getElementById("assignedInstancesBody").innerHTML = "";

    // Reset instance dropdown initially
    document.getElementById("instanceSelect").innerHTML = `
        <option value="">
            Select Instance
        </option>
    `;
}
// showing manage users tab
window.addEventListener("DOMContentLoaded", () => {

    const role = localStorage.getItem("role");

    if (role !== "admin") {

        const tab =
            document.getElementById("manageUsersTab");

        if (tab) {
            tab.style.display = "none";
        }

    }

});

async function loadInstancesForAssign() {

    const userId =
        document.getElementById("userSelect").value;

    if (!userId) return;

    const token =
        localStorage.getItem("token");

    const res = await fetch(
        `http://localhost:3000/available-instances/${userId}`,
        {
            headers: {
                Authorization: "Bearer " + token
            }
        }
    );

    const servers = await res.json();

    const select =
        document.getElementById("instanceSelect");

    select.innerHTML =
        '<option value="">Select Instance</option>';

    servers.forEach(server => {

        select.innerHTML += `
            <option value="${server.id}">
                ${server.server_name}
            </option>
        `;

    });

}

//backward-forward js
window.addEventListener("pageshow", function (event) {

    if (event.persisted) {

        const token = localStorage.getItem("token");

        if (!token) {
            window.location.replace("login.html");
        }

    }

});
window.addEventListener("popstate", function (event) {

    if (event.state && event.state.tab) {

        showTab(event.state.tab, false);

    } else {

        showTab("homeTab", false);

    }

});
window.addEventListener("load", function () {

    const tab = location.hash.replace("#", "");

    if (
        tab === "homeTab" ||
        tab === "reportsTab" ||
        tab === "usersTab"
    ) {

        showTab(tab, false);

    } else {

        history.replaceState(
            { tab: "homeTab" },
            "",
            "#homeTab"
        );

    }

});



async function loadAssignedInstances() {

    const userId =
        document.getElementById("userSelect").value;

    const tbody =
        document.getElementById("assignedInstancesBody");

    if (!userId) {

        tbody.innerHTML = "";

        return;
    }

    const token =
        localStorage.getItem("token");

    const res = await fetch(
        `http://localhost:3000/assigned-instances/${userId}`,
        {
            headers: {
                Authorization: "Bearer " + token
            }
        }
    );

    const instances = await res.json();

    tbody.innerHTML = "";

    instances.forEach((instance, index) => {

        tbody.innerHTML += `
        <tr>
            <td>${index + 1}</td>

            <td>${instance.server_name}</td>

            <td>
                <button
                    class="btn btn-danger btn-sm"
                    onclick="denyInstanceAccess(${userId}, ${instance.id})">

                    Deny

                </button>
            </td>
        </tr>
    `;

    });

}

function userChanged() {

    loadAssignedInstances();
    loadInstancesForAssign();

}

function loadReportTable() {

    fetch("http://localhost:3000/backup-report", {
        headers: {
            Authorization: "Bearer " + localStorage.getItem("token")
        }
    })
        .then(res => res.json())
        .then(data => {

            const tbody = document.getElementById("reportTable");
            tbody.innerHTML = "";

            data.forEach(row => {

                tbody.innerHTML += `
                <tr>
                    <td>${row.server_name}</td>
                    <td>${row.backup_type}</td>
                    <td>${row.status}</td>
                    <td>${row.progress}%</td>
                    <td>${new Date(row.created_at).toLocaleString()}</td>
                </tr>
            `;

            });

        });

}
async function loadReportStats() {

    const response = await fetch(
        "http://localhost:3000/report-stats",
        {
            headers: {
                Authorization: "Bearer " + token
            }
        }
    );

    const data = await response.json();

    document.getElementById("totalBackups").innerText =
        data.total || 0;

    document.getElementById("successBackups").innerText =
        data.completed || 0;

    document.getElementById("failedBackups").innerText =
        data.failed || 0;

    const rate =
        data.total == 0
            ? 0
            : Math.round((data.completed / data.total) * 100);

    document.getElementById("successRate").innerText =
        rate + "%";
}




const themeToggle = document.getElementById("themeToggle");

// Load saved theme
if (localStorage.getItem("theme") === "dark") {
    document.body.classList.add("dark-mode");
    themeToggle.innerHTML = "☀️ Light Mode";
}

themeToggle.addEventListener("click", () => {

    document.body.classList.toggle("dark-mode");

    if (document.body.classList.contains("dark-mode")) {

        localStorage.setItem("theme", "dark");
        themeToggle.innerHTML = "☀️ Light Mode";

    } else {

        localStorage.setItem("theme", "light");
        themeToggle.innerHTML = "🌙 Dark Mode";

    }

});