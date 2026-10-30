const fs = require('node:fs');
for (const [f, val] of [['zh.json', '本页 {{count}} 项'], ['en.json', '{{count}} on this page']]) {
  const p = f;
  const raw = fs.readFileSync(p, 'utf8');
  const data = JSON.parse(raw);
  if (!data.images) data.images = {};
  if (!data.images.page_items) {
    data.images.page_items = val;
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(f, 'added page_items');
  } else console.log(f, 'exists');
}
