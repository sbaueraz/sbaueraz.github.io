const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Serve all files in the "data" folder
app.use('/data', express.static(path.join(__dirname, 'data')));

// Serve static files (HTML, JS, CSS, etc.)
app.use(express.static(path.join(__dirname)));

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
