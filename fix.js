import fs from 'fs';
let content = fs.readFileSync('index.html', 'utf8');
content = content.replace("NHK Bilingual News Reader", "Japan Times Bilingual News Reader");
fs.writeFileSync('index.html', content);
