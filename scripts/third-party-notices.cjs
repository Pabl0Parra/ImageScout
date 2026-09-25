const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const lock = JSON.parse(
  fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'),
);
const sections = [
  'ImageScout third-party notices\nFrontend dependencies are bundled into dist; their notices are retained here.',
];
for (const [directory, metadata] of Object.entries(lock.packages)) {
  if (!directory || metadata.dev) continue;
  const location = path.join(root, directory);
  if (!fs.existsSync(location)) continue;
  const pkg = JSON.parse(
    fs.readFileSync(path.join(location, 'package.json'), 'utf8'),
  );
  const notices = fs
    .readdirSync(location)
    .filter(
      (file) =>
        /^(licen[cs]e|copying|notice|third.party.notices)(\.|$)/i.test(file) &&
        fs.statSync(path.join(location, file)).isFile(),
    );
  sections.push(
    `${pkg.name} ${pkg.version}\nLicense: ${metadata.license || pkg.license || 'See package source'}\n${notices.map((file) => fs.readFileSync(path.join(location, file), 'utf8')).join('\n')}`,
  );
}
fs.writeFileSync(
  path.join(root, 'resources', 'THIRD-PARTY-NOTICES.txt'),
  sections.join('\n\n----------------------------------------\n\n'),
);
console.log('Retained bundled dependency license notices.');
