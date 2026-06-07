const modal = document.querySelector(".modal");
const addBtn = document.querySelector(".add-instance-btn");
const closeBtn = document.querySelector(".close-btn");

addBtn.addEventListener("click", () => {
    modal.style.display = "flex";
});

closeBtn.addEventListener("click", () => {
    modal.style.display = "none";
});

window.addEventListener("click", (e) => {
    if(e.target === modal){
        modal.style.display = "none";
    }
});