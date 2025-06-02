const fs = require("fs");
const path = require("path");

// Define the file to update
const scriptFilePath = path.join(__dirname, "script.js");

// Function to update URLs in script.js
function updateBackendUrl(newUrl) {
    try {
        // Read the current content of script.js
        let content = fs.readFileSync(scriptFilePath, "utf8");

        // The old URL to replace (match the BACKEND_URL format in script.js)
        const oldUrlRegex = /const BACKEND_URL = ".*?";/;
        const newUrlLine = `const BACKEND_URL = "${newUrl}";`;

        // Replace the BACKEND_URL line with the new URL
        const updatedContent = content.replace(oldUrlRegex, newUrlLine);

        // Write the updated content back to script.js
        fs.writeFileSync(scriptFilePath, updatedContent, "utf8");
        console.log(`Updated backend URL to ${newUrl} in script.js`);
    } catch (error) {
        console.error("Error updating URLs:", error);
    }
}

// Get the new ngrok URL from command-line arguments
const newNgrokUrl = process.argv[2];
if (!newNgrokUrl) {
    console.error("Please provide the new ngrok URL as an argument.");
    console.error("Example: node update-urls.js https://new-subdomain.ngrok-free.app");
    process.exit(1);
}

// Run the update
updateBackendUrl(newNgrokUrl);