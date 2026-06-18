const params =
    new URLSearchParams(
        window.location.search
    );

const id =
    params.get("id");

async function loadLog() {

    const response =
        await fetch(
            `http://localhost:3000/backup-logs/${id}`
        );

    const log =
        await response.json();

    document.getElementById("serverName").innerText =
        log.server_name;

    document.getElementById("backupType").innerText =
        log.backup_type;

    document.getElementById("status").innerText =
        log.status;

    document.getElementById("progress").innerText =
        log.progress + "%";

    document.getElementById("createdAt").innerText =
        log.created_at;
     
    document.getElementById("fileSize").innerText =
        log.file_size;

    document.getElementById("duration").innerText =
        log.duration;

    document.getElementById("remarks").innerText =
        log.remarks;    

}

loadLog();