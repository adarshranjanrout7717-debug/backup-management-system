const express = require("express");
const app = express();
const path = require("path");
const ejsMate = require("ejs-mate");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");

app.set("view engine", "ejs");
app.engine("ejs", ejsMate);
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));


app.listen(8080, () => {
    console.log("app is listening on port 8080.");
});


const connection = mysql.createConnection({
    host: "localhost",
    user: "root",
    database: "test",
    password: "Ritikdas@378"
});

// const connection1 = mysql.createConnection({
//     host: "10.180.21.214",
//     port: 3306,
//     user: "team1",
//     password: "Team@123",
//     database: "rbms"
// });

app.get("/", (req, res) => {
    res.render("index.ejs", { error: null });
});

app.post("/submit", (req, res) => {
    const { username, password } = req.body;
    const sql = `select * from users where username= ? and password= ?;`;
    connection.query(sql, [username,password], (err, result) => {
        if (err) {
            return res.send("Database Error");
        } if (result.length === 0) {
            return res.render("index.ejs", {
                error: "Invalid Username or password"
            });
        } else{
            res.render("second.ejs");
        }

        
    })

});




// connection1.query("select * from users;",(err,result)=>{
//     if(result){
//         console.log(result);
//     }
// });