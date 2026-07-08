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

// Holds the full, unfiltered list of backup logs fetched from the
// server. filterReports() filters a copy of this, exportCSV() reads
// straight from it - both need the complete set, not just whatever
// is currently rendered in the table.
let allLogs = [];

/////////////////////////////////////////////////////////
// BLOCK PAST DATES/TIMES ON SCHEDULE BACKUP
/////////////////////////////////////////////////////////

function setScheduleTimeMin() {

    const input =
        document.getElementById("scheduleTime");

    if (!input) {
        return;
    }

    const now = new Date();

    // datetime-local needs "YYYY-MM-DDTHH:MM" in LOCAL time
    // (not UTC), so build the string manually instead of using
    // toISOString(), which would shift the time to UTC.
    const pad = (n) => String(n).padStart(2, "0");

    const localMinValue =
        now.getFullYear() + "-" +
        pad(now.getMonth() + 1) + "-" +
        pad(now.getDate()) + "T" +
        pad(now.getHours()) + ":" +
        pad(now.getMinutes());

    input.min = localMinValue;

}

// Set it once on page load
setScheduleTimeMin();

// Keep it current: refresh every 30 seconds in case the page
// is left open a while before the user picks a time.
setInterval(setScheduleTimeMin, 30000);

// Live validation: runs every time the user changes the date/time
// field. Shows an inline message and disables the Schedule Backup
// button while the selected value is in the past, re-enabling it
// the moment a valid future value is picked.
function validateScheduleTime() {

    const input =
        document.getElementById("scheduleTime");

    const errorBox =
        document.getElementById("scheduleTimeError");

    const button =
        document.getElementById("scheduleBackupBtn");

    if (!input || !errorBox || !button) {
        return true;
    }

    if (!input.value) {
        // Nothing picked yet - don't show an error, but also
        // don't allow submitting.
        errorBox.style.display = "none";
        button.disabled = true;
        return false;
    }

    const scheduledDate = new Date(input.value);

    if (scheduledDate.getTime() <= Date.now()) {

        errorBox.textContent =
            "Selected time has already passed. Please choose a future date and time.";

        errorBox.style.display = "block";

        button.disabled = true;

        return false;

    }

    errorBox.style.display = "none";
    button.disabled = false;

    return true;

}

// Run once on load too, in case the field somehow has a
// pre-filled value already.
validateScheduleTime();

// Re-run validation live as the user picks/changes a date or time,
// so the button disables/enables immediately instead of only on load.
// (The HTML's onchange="validateScheduleTime()" on #scheduleTime covers
// the change event already - this also adds "input" so it reacts the
// moment a value is picked, not only after the field loses focus.)
const scheduleTimeInputEl = document.getElementById("scheduleTime");

if (scheduleTimeInputEl) {
    scheduleTimeInputEl.addEventListener("input", validateScheduleTime);
}

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

    // Toggle which nav button looks "active" - previously only Home
    // ever had the class (hardcoded in HTML), so it stayed highlighted
    // blue no matter which tab you were actually on.
    document.querySelectorAll(".nav-link[data-tab]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tabId);
    });

    // Clicking Home always lands back on the overview (cards + recent
    // backups), not wherever the instance detail view happened to be
    // left before switching tabs. Also clears selectedServerId -
    // otherwise the 10s auto-refresh interval below still sees an
    // instance "selected" and calls loadServerDetails() again, which
    // flips the view right back to the instance detail panel a few
    // seconds after you clicked Home.
    if (tabId === "homeTab") {
        selectedServerId = null;
        showHomeOverview();
        loadServers();
    }

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

        if (servers.length === 0) {

            document.getElementById("instanceList").innerHTML = `
<div class="instance-empty-state">
    <i class="fa-solid fa-server"></i>
    <p>No Instances Yet</p>
</div>
`;

            return;
        }

        let html = "";

        const isAdminUser = localStorage.getItem("role") === "admin";

        servers.forEach(server => {

            const isActive =
                selectedServerId === server.id;

            html += `
<div class="instance-item${isActive ? " active" : ""}"
     onclick="loadServerDetails(${server.id})">

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

        <div class="d-flex flex-column align-items-end gap-2">

            ${server.connection_status === "Online"
                    ? '<span class="text-success">●</span>'
                    : '<span class="text-danger">●</span>'
                }

            ${isAdminUser ? `
            <button
                type="button"
                class="instance-delete-btn"
                title="Delete instance"
                onclick="event.stopPropagation(); confirmDeleteInstance(${server.id}, '${server.server_name.replace(/'/g, "\\'")}')">
                <i class="fa-solid fa-trash"></i>
            </button>
            ` : ""}

        </div>

    </div>

</div>
`;
            ;
        });

        document.getElementById("instanceList").innerHTML = html;

    } catch (error) {

        console.log(error);

    }
}

/////////////////////////////////////////////////////////
// DELETE INSTANCE
/////////////////////////////////////////////////////////

// Asks for confirmation before deleting an instance, matching the
// same confirm() pattern already used by denyInstanceAccess().
function confirmDeleteInstance(id, serverName) {

    if (!confirm(`Delete instance "${serverName}"? This cannot be undone.`)) {
        return;
    }

    deleteInstance(id);

}

async function deleteInstance(id) {

    try {

        const response = await fetch(
            `http://localhost:3000/server/${id}`,
            {
                method: "DELETE",
                headers: {
                    Authorization: "Bearer " + token
                }
            }
        );

        const data = await response.json();

        handleUnauthorized(data);

        if (data.success) {

            alert(data.message || "Instance Deleted Successfully");

            // If the deleted instance was the one currently selected,
            // clear the details panel, selection state, and go back to
            // the Home overview instead of leaving stale data from a
            // server that no longer exists.
            if (selectedServerId === id) {

                selectedServerId = null;

                document.getElementById("instanceName").value = "";
                document.getElementById("databaseType").value = "";
                document.getElementById("instanceIp").value = "";
                document.getElementById("instanceStatus").value = "";
                document.getElementById("lastDownTime").value = "";
                document.getElementById("lastBackupLocation").value = "";
                document.getElementById("lastBackupDate").value = "";
                document.getElementById("backupDuration").value = "";
                document.getElementById("backupSize").value = "";
                document.getElementById("backupRemark").value = "";

                showHomeOverview();

            }

            // Note: this only removes the servers row. backup_logs
            // and scheduled_backups store server_name as plain text
            // with no foreign key back to servers, so backup history
            // for this instance is preserved in the Reports page even
            // after the instance itself is gone.
            loadServers();
            loadDashboardSummary();

        } else {

            alert(data.message || "Failed To Delete Instance");

        }

    } catch (error) {

        console.log(error);

        alert("Failed To Delete Instance");

    }

}

/////////////////////////////////////////////////////////
// HOME OVERVIEW <-> INSTANCE DETAIL VIEW TOGGLE
/////////////////////////////////////////////////////////

// Home tab now has two states in its right-hand panel: the overview
// (welcome message + summary cards + recent backups) shown by
// default, and the existing Instance Details/backup form shown once
// an instance is clicked. These two just toggle which one is visible.

function showHomeOverview() {

    const overview = document.getElementById("homeOverview");
    const detail = document.getElementById("instanceDetailView");

    if (overview) overview.style.display = "block";
    if (detail) detail.style.display = "none";

}

function showInstanceDetailView() {

    const overview = document.getElementById("homeOverview");
    const detail = document.getElementById("instanceDetailView");

    if (overview) overview.style.display = "none";
    if (detail) detail.style.display = "block";

}

/////////////////////////////////////////////////////////
// DASHBOARD SUMMARY (Home overview cards + recent backups)
/////////////////////////////////////////////////////////

async function loadDashboardSummary() {

    try {

        const response = await fetch(
            "http://localhost:3000/dashboard-summary",
            {
                headers: {
                    Authorization: "Bearer " + token
                }
            }
        );

        const data = await response.json();

        handleUnauthorized(data);

        if (!data.success) {
            return;
        }

        document.getElementById("homeTotalInstances").innerText =
            data.totalInstances;

        document.getElementById("homeOnlineInstances").innerText =
            data.online;

        document.getElementById("homeOfflineInstances").innerText =
            data.offline;

        document.getElementById("homeTotalBackups").innerText =
            data.totalBackups;

        const tbody = document.getElementById("recentBackupsBody");

        if (!data.recentBackups || data.recentBackups.length === 0) {

            tbody.innerHTML =
                `<tr><td colspan="6" class="text-center text-muted py-4">No backups yet</td></tr>`;

            return;

        }

        let html = "";

        data.recentBackups.forEach((log, index) => {

            html += `
<tr>
<td>${index + 1}</td>
<td>${log.server_name}</td>
<td>${log.database_type || "-"}</td>
<td>${statusBadge(log.status)}</td>
<td>${log.duration || "-"}</td>
<td>
${log.created_at ? new Date(log.created_at).toLocaleString() : "-"}
</td>
</tr>
`;

        });

        tbody.innerHTML = html;

    } catch (error) {

        console.log(error);

    }

}

/////////////////////////////////////////////////////////
// LOAD SERVER DETAILS
/////////////////////////////////////////////////////////

async function loadServerDetails(id) {

    selectedServerId = id;

    // Re-render the list immediately so the clicked instance is
    // highlighted right away, instead of waiting up to 10 seconds
    // for the next auto-refresh.
    loadServers();

    // Switch the right panel from the Home overview to the Instance
    // Details/backup form for the instance that was just clicked.
    showInstanceDetailView();

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
    server.last_backup_date
        ? new Date(server.last_backup_date).toLocaleString('en-IN', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true
          })
        : "";

document.getElementById("lastDownTime").value =
    server.last_down_time
        ? new Date(server.last_down_time).toLocaleString('en-IN', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true
          })
        : "";

        // Admin-only: who last ran a backup on this instance. Hidden
        // entirely for non-admin users, not just left blank.
        const triggeredByWrap = document.getElementById("lastBackupTriggeredByWrap");

        if (triggeredByWrap) {

            if (localStorage.getItem("role") === "admin") {
                triggeredByWrap.style.display = "block";
                document.getElementById("lastBackupTriggeredBy").value =
                    server.last_backup_triggered_by || "";
            } else {
                triggeredByWrap.style.display = "none";
            }

        }

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

// Exactly 4 dot-separated octets, each 0-255, no letters/special
// chars, no spaces, no extra dots, no negative numbers.
// "localhost" is NOT accepted - use 127.0.0.1 instead.
const ipv4Regex =
    /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;

// Live feedback as the user types in the Add Instance modal: shows
// "Invalid IP Address" the moment the field doesn't match yet, and
// clears it the moment a correction (e.g. backspacing a typo) makes
// it valid again. Also disables Check Connection until the IP is
// actually valid - testing a connection to a malformed address isn't
// meaningful, so the button stays greyed out until it is.
function validateIpAddressLive() {

    const input = document.getElementById("ipAddress");
    const errorBox = document.getElementById("ipAddressError");
    const checkBtn = document.getElementById("checkConnectionBtn");

    if (!input || !errorBox) {
        return;
    }

    const isValid = ipv4Regex.test(input.value);

    if (!input.value || isValid) {
        errorBox.style.display = "none";
        errorBox.textContent = "";
    } else {
        errorBox.textContent = "Invalid IP Address";
        errorBox.style.display = "block";
    }

    if (checkBtn) {
        checkBtn.disabled = !isValid;
    }

}

const ipAddressInputEl = document.getElementById("ipAddress");

if (ipAddressInputEl) {
    ipAddressInputEl.addEventListener("input", validateIpAddressLive);
}

// Add Instance modal: give the nav button a visible "active" state
// while the modal is open (matching how the other nav tabs look when
// selected), and clear it again once the modal closes - instead of it
// just sitting there unstyled the whole time regardless of state.
const addInstanceModalEl = document.getElementById("addInstanceModal");

if (addInstanceModalEl) {

    addInstanceModalEl.addEventListener("show.bs.modal", () => {
        const btn = document.querySelector('[data-bs-target="#addInstanceModal"]');
        if (btn) btn.classList.add("active");
        validateIpAddressLive();
    });

    addInstanceModalEl.addEventListener("hidden.bs.modal", () => {
        const btn = document.querySelector('[data-bs-target="#addInstanceModal"]');
        if (btn) btn.classList.remove("active");
    });

}

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

    if (!ipv4Regex.test(ip_address)) {

        alert("Invalid IP Address. Enter a valid IPv4 address (e.g. 192.168.1.1).");

        return;

    }

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
            loadDashboardSummary();

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

//////////////////////////////////////////////////////////
// LOAD LOGS + REPORTS
/////////////////////////////////////////////////////////

async function loadLogs() {

    const loadingEl = document.getElementById("reportsLoadingState");
    const tableWrap = document.getElementById("reportsTableWrap");
    const emptyEl = document.getElementById("reportsEmptyState");

    // Show the spinner and hide the table/empty-state while the
    // request is in flight, instead of leaving a blank table.
    if (loadingEl) loadingEl.style.display = "flex";
    if (tableWrap) tableWrap.style.display = "none";
    if (emptyEl) emptyEl.style.display = "none";

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

        // Keep the full unfiltered list around for filterReports()
        // and exportCSV() to use, then render everything by default.
        allLogs = logs;

        populateInstanceFilter(logs);

        renderReports(allLogs);

    } catch (error) {

        console.log(error);

    } finally {

        if (loadingEl) loadingEl.style.display = "none";

    }
}

// Fills the "All Instances" dropdown with the distinct server names
// that actually appear in the loaded logs (so a non-admin user only
// ever sees instances they have backups for, matching what /backup-logs
// already scoped server-side). Keeps the currently selected value if
// it's still present after a refresh.
function populateInstanceFilter(logs) {

    const select = document.getElementById("instanceFilter");

    if (!select) {
        return;
    }

    const previousValue = select.value;

    const uniqueNames =
        [...new Set(logs.map(l => l.server_name))].sort();

    let html = '<option value="">All Instances</option>';

    uniqueNames.forEach(name => {
        html += `<option value="${name}">${name}</option>`;
    });

    select.innerHTML = html;

    if (uniqueNames.includes(previousValue)) {
        select.value = previousValue;
    }

}

// Returns the small colored pill for a given status. Anything other
// than the four known statuses falls back to the grey "queued" look
// rather than rendering nothing.
function statusBadge(status) {

    switch (status) {
        case "Completed":
            return '<span class="rpt-badge is-completed">Completed</span>';
        case "Failed":
            return '<span class="rpt-badge is-failed">Failed</span>';
        case "Running":
            return '<span class="rpt-badge is-running">Running</span>';
        case "Scheduled":
            return '<span class="rpt-badge is-scheduled">Scheduled</span>';
        default:
            return `<span class="rpt-badge is-scheduled">${status || "Scheduled"}</span>`;
    }
}

// Renders the summary cards + report table from whatever log array
// is passed in. loadLogs() passes the full list; filterReports()
// passes a filtered subset - same renderer either way. Also tracks
// what's currently on screen so viewReport()'s index always lines up
// with the right row, whether the table is showing everything or a
// filtered subset.
let currentlyRenderedLogs = [];

function renderReports(logs) {

    currentlyRenderedLogs = logs;

    // Total Backups only counts backups that have actually run
    // (Completed or Failed) - Scheduled/Running rows are pending
    // attempts, not completed ones, so they're excluded here to
    // keep Success Rate meaningful.
    const executedLogs =
        logs.filter(l => l.status === "Completed" || l.status === "Failed");

    const totalBackups = executedLogs.length;

    const successBackups =
        logs.filter(l => l.status === "Completed").length;

    const failedBackups =
        logs.filter(l => l.status === "Failed").length;

    const successRate =
        totalBackups === 0
            ? 0
            : Math.round((successBackups / totalBackups) * 100);

    document.getElementById("totalBackups").innerText =
        totalBackups;

    document.getElementById("successBackups").innerText =
        successBackups;

    document.getElementById("failedBackups").innerText =
        failedBackups;

    document.getElementById("successRate").innerText =
        successRate + "%";

    const tableWrap = document.getElementById("reportsTableWrap");
    const emptyEl = document.getElementById("reportsEmptyState");

    if (logs.length === 0) {

        if (tableWrap) tableWrap.style.display = "none";
        if (emptyEl) emptyEl.style.display = "flex";

        document.getElementById("reportTable").innerHTML = "";

        return;
    }

    if (tableWrap) tableWrap.style.display = "block";
    if (emptyEl) emptyEl.style.display = "none";

    let html = "";

    logs.forEach((log, index) => {

        html += `
<tr>
<td>${index + 1}</td>
<td>${log.server_name}</td>
<td>${log.database_type || "-"}</td>
<td>${log.backup_type}</td>
<td>${statusBadge(log.status)}</td>
<td>${log.file_size || "-"}</td>
<td>${log.duration || "-"}</td>
<td>
${new Date(log.created_at).toLocaleString()}
</td>
<td>
<button
class="btn btn-sm btn-outline-primary rpt-view-btn"
onclick="viewReport(${index})">
<i class="fa-solid fa-eye"></i>
View Details
</button>
</td>
</tr>
`;

    });

    document.getElementById("reportTable").innerHTML = html;
}

// Filters the in-memory allLogs array based on the Reports tab's
// search box, status/type/database dropdowns, and date range, then
// re-renders the table with just the matching rows. Note: indexes
// passed to viewReport() below are relative to this filtered array,
// not allLogs - viewReport() reads from whatever was last rendered.
function filterReports() {

    let filtered = [...allLogs];

    const search =
        document.getElementById("searchReport").value.toLowerCase();

    const status =
        document.getElementById("statusFilter").value;

    const type =
        document.getElementById("typeFilter").value;

    const dbType =
        document.getElementById("dbFilter").value;

    const instance =
        document.getElementById("instanceFilter").value;

    const from =
        document.getElementById("fromDate").value;

    const to =
        document.getElementById("toDate").value;

    if (search) {
        filtered = filtered.filter(l =>
            l.server_name.toLowerCase().includes(search)
        );
    }

    if (status) {
        filtered = filtered.filter(l =>
            l.status === status
        );
    }

    if (type) {
        filtered = filtered.filter(l =>
            l.backup_type === type
        );
    }

    if (dbType) {
        filtered = filtered.filter(l =>
            l.database_type === dbType
        );
    }

    if (instance) {
        filtered = filtered.filter(l =>
            l.server_name === instance
        );
    }

    if (from) {
        filtered = filtered.filter(l =>
            new Date(l.created_at) >= new Date(from)
        );
    }

    if (to) {
        filtered = filtered.filter(l =>
            new Date(l.created_at) <= new Date(to + " 23:59:59")
        );
    }

    renderReports(filtered);
}

// Clears every filter input back to its default and re-renders the
// full, unfiltered list.
function resetFilters() {

    document.getElementById("searchReport").value = "";
    document.getElementById("statusFilter").value = "";
    document.getElementById("typeFilter").value = "";
    document.getElementById("dbFilter").value = "";
    document.getElementById("instanceFilter").value = "";
    document.getElementById("fromDate").value = "";
    document.getElementById("toDate").value = "";

    renderReports(allLogs);
}

// Exports the FULL unfiltered log list as CSV, not just whatever is
// currently filtered/visible in the table - this matches the most
// common expectation for an "Export CSV" button (a complete record),
// but means it won't respect active filters. Flagging this here in
// case that's not the behavior you want.
function exportCSV() {

    let csv = [];

    csv.push("Server,Database,Backup Type,Status,Size,Duration,Backup Date");

    allLogs.forEach(log => {

        csv.push(
            `"${log.server_name}","${log.database_type || ""}","${log.backup_type}","${log.status}","${log.file_size || ""}","${log.duration || ""}","${new Date(log.created_at).toLocaleString()}"`
        );

    });

    const blob = new Blob([csv.join("\n")], {
        type: "text/csv"
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download = "backup_report.csv";
    a.click();

    URL.revokeObjectURL(url);
}

// Shows details for one report row in the shared Bootstrap modal,
// instead of an alert(). Reads from currentlyRenderedLogs (whatever
// renderReports() last drew - either the full list or a filtered
// subset), since the index in the View button's onclick is relative
// to whatever was actually on screen when it was rendered, not
// necessarily allLogs.
function viewReport(index) {

    const log = currentlyRenderedLogs[index];

    if (!log) {
        return;
    }

    document.getElementById("modalServerName").innerText =
        log.server_name || "-";

    document.getElementById("modalDatabaseType").innerText =
        log.database_type || "-";

    document.getElementById("modalBackupType").innerText =
        log.backup_type || "-";

    const statusHtml = statusBadge(log.status);

    if (!log.status) {
        console.warn("viewReport(): log.status is empty/undefined for this row:", log);
    }

    document.getElementById("modalStatus").innerHTML =
        statusHtml || "-";

    document.getElementById("modalDate").innerText =
        log.created_at ? new Date(log.created_at).toLocaleString() : "-";

    // Admin-only: hidden entirely (not just blank) for non-admin users.
    const triggeredByWrap = document.getElementById("modalTriggeredByWrap");

    if (triggeredByWrap) {

        if (localStorage.getItem("role") === "admin") {
            triggeredByWrap.style.display = "block";
            document.getElementById("modalTriggeredBy").innerText =
                log.triggered_by_username || "-";
        } else {
            triggeredByWrap.style.display = "none";
        }

    }

    document.getElementById("modalLocation").innerText =
        log.backup_location || "-";

    document.getElementById("modalFileSize").innerText =
        log.file_size || "-";

    document.getElementById("modalDuration").innerText =
        log.duration || "-";

    document.getElementById("modalFilePath").innerText =
        log.backup_file_path || "-";

    document.getElementById("modalRemarks").innerText =
        log.remarks || "-";

    const modalEl = document.getElementById("reportDetailsModal");
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

    modal.show();
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
                backup_type: "Fast Backup",
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
        loadDashboardSummary();

    } else {

        alert(data.message);

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

    // Re-check the date/time is still valid (not in the past) right
    // before submitting, as a safety net in case the button was
    // somehow still enabled.
    if (!validateScheduleTime()) {

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

    if (!backup_path) {

        alert("Enter Backup Path");

        return;
    }

    if (!schedule_time) {

        alert("Pick a Schedule Date and Time");

        return;
    }

    try {

        const response = await fetch(
            "http://localhost:3000/schedule-backup",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token
                },
                body: JSON.stringify({
                    server_name,
                    database_type,
                    backup_type: "Scheduled Backup",
                    backup_location,
                    backup_path,
                    schedule_time
                })
            }
        );

        const data = await response.json();

        handleUnauthorized(data);

        if (data.success) {

            alert("Backup Scheduled Successfully");

            // Clear the form so it's obvious the schedule went through,
            // and so the (currently disabled-while-empty) button starts
            // fresh for the next schedule.
            document.getElementById("schedulePath").value = "";
            document.getElementById("scheduleTime").value = "";

            validateScheduleTime();

            loadDashboardSummary();

        } else {

            alert(data.message || "Failed To Schedule Backup");

        }

    } catch (error) {

        console.log(error);

        alert("Schedule Backup Failed");

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
loadDashboardSummary();

/////////////////////////////////////////////////////////
// AUTO REFRESH
/////////////////////////////////////////////////////////

setInterval(() => {

    // loadServerDetails() already re-runs loadServers() internally
    // (to keep the active highlight in sync), so call only one or
    // the other to avoid fetching /servers twice per tick.
    if (selectedServerId) {
        loadServerDetails(selectedServerId);
    } else {
        loadServers();
    }

    // Keeps the Home overview's counts/recent-backups list current
    // regardless of which state (overview vs instance detail) is
    // currently visible, so it's up to date the moment you switch
    // back to the overview.
    loadDashboardSummary();

    // loadLogs() intentionally removed from auto-refresh: the
    // Reports table now only updates via the manual Refresh button
    // or when a backup completes, instead of re-rendering every 10s
    // (which was disruptive while reading/filtering the table).

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

        const addInstanceTab =
            document.getElementById("addInstanceTab");

        if (addInstanceTab) {
            addInstanceTab.style.display = "none";
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
        tab === "logsTab" ||
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