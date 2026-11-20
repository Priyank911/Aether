await space.logStep('Open the Code Mode example page');
const page = await space.open('https://example.com/');
return { title: page.title, url: page.url, archetype: page.archetype, skim: page.skim };
