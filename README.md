# 🚀 Backup Management System (RBMS)

A centralized **Backup Management System** designed to manage and monitor backups across multiple database instances. The system supports both **MySQL** and **Oracle** databases, allowing administrators to register database instances, generate backups, maintain backup history, and restore data when required.



# 📌 Overview

The Backup Management System provides a single platform to:

* Register multiple database instances.
* Connect to MySQL and Oracle databases dynamically.
* Generate on-demand database backups.
* Store backups in a centralized backup location.
* View backup history and logs.
* Restore backups when required.
* Monitor backup status through a simple web interface.



# ✨ Features

* 🔐 User Authentication
* 🗄️ Multiple Database Instance Management
* 🐬 MySQL Database Support
* 🏛️ Oracle Database Support
* 💾 Backup Generation
* ♻️ Backup Restore
* 📂 Backup History
* 📊 Dashboard for Monitoring
* ⚡ Real-time Database Connectivity
* 📁 Centralized Backup Storage



# 🏗️ System Architecture

```text
                    +----------------------+
                    |     Web Interface    |
                    +----------+-----------+
                               |
                               |
                    +----------v-----------+
                    |     Node.js Server   |
                    |      (Express.js)    |
                    +----------+-----------+
                               |
               +---------------+----------------+
               |                                |
       +-------v--------+               +--------v-------+
       |  Application   |               | Instance       |
       | MySQL Database |               | Connections    |
       +----------------+               +--------+-------+
                                                 |
                              +------------------+------------------+
                              |                                     |
                     +--------v--------+                   +---------v---------+
                     | MySQL Instances |                   | Oracle Instances  |
                     +-----------------+                   +-------------------+
                                                 |
                                                 |
                                      +----------v-----------+
                                      | Central Backup Store |
                                      +----------------------+
```



# 🛠️ Technology Stack

### Frontend

* HTML5
* CSS3
* JavaScript

### Backend

* Node.js
* Express.js

### Database

* MySQL
* Oracle Database

### Libraries

* mysql2
* oracledb
* bcrypt
* express-session
* body-parser
* dotenv



# 📁 Project Structure

```text
Backup-Management-System/
│
├── css/
├── js/
├── images/
├── routes/
├── services/
├── config/
├── backups/
├── node_modules/
│
├── server.js
├── package.json
├── package-lock.json
├── login.html
├── home.html
└── README.md
```


# ⚙️ Installation

## Clone the Repository

```bash
git clone https://github.com/your-username/backup-management-system.git
```

```bash
cd backup-management-system
```


## Install Dependencies

```bash
npm install
```



## Configure Database

Update the database connection details inside the configuration files.

Example:

### MySQL

* Host
* Port
* Username
* Password
* Database Name

### Oracle

* Host
* Port
* Service Name
* Username
* Password



## Start the Application

```bash
node server.js
```

or

```bash
npm start
```



# 📂 Backup Workflow

1. Login to the application.
2. Register a database instance.
3. Test the database connection.
4. Generate a backup.
5. Store the backup in the configured location.
6. View backup history.
7. Restore backup whenever required.



# 📊 Supported Databases

| Database        | Supported |
| --------------- | --------- |
| MySQL           | ✅         |
| Oracle Database | ✅         |



# 📷 Application Modules

* Login
* Dashboard
* Database Instance Management
* Backup Management
* Restore Management
* Backup History
* User Management



# 🔒 Security

* Password Hashing
* Session-based Authentication
* Secure Database Connections
* Protected Routes



# 🚀 Future Enhancements

* Scheduled Automatic Backups
* Email Notifications
* Backup Compression
* Backup Encryption
* Cloud Storage Integration (AWS S3)
* Role-Based Access Control (RBAC)
* Backup Health Monitoring
* Backup Scheduling Dashboard
* Multi-user Support



# 👨‍💻 Developers

Developed as part of the **Backup Management System (RBMS)** project.



# 📄 License

This project is intended for educational and internal development purposes.



## ⭐ If you found this project useful, consider giving it a star on GitHub!
