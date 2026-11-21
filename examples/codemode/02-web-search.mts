/// <reference path="./space.d.ts" />
const query = 'Aether agentic browser';
await space.logStep(`Search the web for ${query}`);
const page = await space.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
console.log(JSON.stringify({ title: page.title, url: page.url, skim: page.skim }));
