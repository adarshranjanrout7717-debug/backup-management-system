// LIVE CLOCK

setInterval(() => {

    document.getElementById("clock").innerHTML =
    new Date().toLocaleString();

}, 1000);


// BAR CHART

const ctx = document.getElementById('backupChart');

new Chart(ctx, {

    type: 'bar',

    data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

        datasets: [{
            label: 'Backups',
            data: [12, 19, 8, 15, 10, 17],
            borderWidth: 1
        }]
    },

    options: {

        responsive: true,

        plugins: {
            legend: {
                labels: {
                    color: "white"
                }
            }
        },

        scales: {

            y: {
                ticks: {
                    color: "white"
                }
            },

            x: {
                ticks: {
                    color: "white"
                }
            }

        }

    }

});


// PIE CHART

const storage = document.getElementById('storageChart');

new Chart(storage, {

    type: 'doughnut',

    data: {
        labels: ['Used', 'Free'],

        datasets: [{
            data: [78, 22]
        }]
    },

    options: {

        responsive: true,

        plugins: {
            legend: {
                labels: {
                    color: "white"
                }
            }
        }

    }

});

async function loadDashboardStats() {

    try {

        const response =
            await fetch("http://localhost:3000/dashboard-stats");

        const data =
            await response.json();

        document.getElementById("totalServers").innerText =
            data.totalServers;

        document.getElementById("successfulBackups").innerText =
            data.successfulBackups;

        document.getElementById("failedBackups").innerText =
            data.failedBackups;

        document.getElementById("storageUsed").innerText =
            data.storageUsed + "%";

    } catch (error) {

        console.log(error);

    }

}

loadDashboardStats();

function logout() {

    localStorage.removeItem(
        "loggedIn"
    );

    window.location.href =
        "login.html";

}