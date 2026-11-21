/// <reference path="./space.d.ts" />
await space.logStep('Open the Code Mode example page');
const page = await space.open('https://example.com/');
console.log(JSON.stringify({ title: page.title, url: page.url, archetype: page.archetype, skim: page.skim }));
