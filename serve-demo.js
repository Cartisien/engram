const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3456;

const server = http.createServer((req, res) => {
    const filePath = req.url === '/' ? '/demo.html' : req.url;
    const fullPath = path.join(__dirname, filePath);
    
    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        
        const ext = path.extname(fullPath);
        const contentType = ext === '.html' ? 'text/html' : 
                           ext === '.js' ? 'application/javascript' : 'text/plain';
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log('Demo server running at http://localhost:' + PORT);
});
