const bcrypt = require("bcrypt");

(async () => {
    const hash = await bcrypt.hash("user1234", 10);
    console.log("HASH:", hash);
})();