const bcrypt = require("bcrypt");

bcrypt.hash("admin123", 10, (err, hash) => {
    console.log(hash);
});