async function login() {

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    // 🔴 VALIDATION
    if (!username || !password) {
        alert("Please enter username and password");
        return;
    }

    try {

        const res = await fetch("http://localhost:3000/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (data.success) {

            // 🔐 STORE SECURE DATA
            localStorage.setItem("token", data.token);
            localStorage.setItem("role", data.role);

            alert("Login Successful");

            window.location.href= "home.html";

        } else {
            alert(data.message || "Invalid credentials");
        }

    } catch (error) {
        console.log(error);
        alert("Server error. Please try again later.");
    }
}