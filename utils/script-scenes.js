// One ordered list of spoken scenes per script, shared by narration, visuals,
// captions and the scene manifest so they always line up.

function textFromSection(section = {}) {
  if (typeof section.narration === 'string' && section.narration.trim()) return section.narration.trim();
  if (typeof section.content === 'string') return /\[[^\]]*\]/.test(section.content) ? '' : section.content;
  if (Array.isArray(section.content)) return section.content.filter(item => typeof item === 'string' && !/\[[^\]]*\]/.test(item)).join(' ');
  if (Array.isArray(section.items)) return section.items.map(item => `${item.title || ''}. ${item.description || ''}`).join(' ');
  if (Array.isArray(section.steps)) return section.steps.map(item => `${item.title || ''}. ${item.description || ''}`).join(' ');
  return '';
}

function scriptScenes(script = {}) {
  const sections = script.mainContent?.sections || [];
  const scenes = [];
  if (script.hook?.text || script.title) {
    const scriptText = script.hook?.text || script.title;
    scenes.push({
      label: 'Hook',
      scriptText,
      onScreen: script.title || scriptText,
      visualQuery: sections[0]?.visualQuery || script.title || '',
      prompt: `${scriptText}. Cinematic opening shot, clear subject, intentional camera movement, no captions or on-screen text.`
    });
  }
  if (script.introduction) {
    const scriptText = [
      script.introduction.greeting,
      script.introduction.topicIntro,
      script.introduction.valueProposition,
      script.introduction.credibility
    ].filter(Boolean).join(' ');
    scenes.push({
      label: 'Introduction', scriptText,
      onScreen: script.title || '',
      visualQuery: script.title || '',
      prompt: `${scriptText}. Establishing visual, clear subject, coherent lighting, no captions or on-screen text.`
    });
  }
  for (const [index, section] of sections.entries()) {
    const scriptText = textFromSection(section);
    const title = section.title || `Scene ${index + 1}`;
    scenes.push({
      label: title,
      scriptText,
      onScreen: section.onScreen || title,
      visualQuery: section.visualQuery || title,
      prompt: `${section.title || ''}. ${scriptText}`.trim() + '. Cinematic explanatory B-roll, natural motion, coherent lighting, no captions or on-screen text.'
    });
  }
  if (script.conclusion) {
    const scriptText = [...(script.conclusion.recap || []), script.conclusion.finalThought].filter(Boolean).join(' ');
    scenes.push({
      label: 'Conclusion', scriptText,
      onScreen: script.title || '',
      visualQuery: script.title || '',
      prompt: `${scriptText}. Memorable cinematic closing shot, no captions or on-screen text.`
    });
  }
  if (script.callToAction) {
    const cta = script.callToAction;
    const scriptText = [cta.subscribe, cta.like, cta.comment, cta.nextVideo]
      .filter(value => typeof value === 'string' && value.trim()).join(' ');
    scenes.push({
      label: 'Call to action', scriptText,
      onScreen: cta.onScreen || 'Subscribe karo!',
      visualQuery: 'youtube subscribe button smartphone',
      prompt: `${scriptText}. Clean closing visual with open composition, no captions or on-screen text.`
    });
  }
  const spoken = scenes.filter(scene => scene.scriptText.trim());
  return spoken.length ? spoken : [{
    label: script.title || 'Video', scriptText: script.fullScript || '', onScreen: script.title || '',
    visualQuery: script.title || '', prompt: script.title || 'Video scene'
  }];
}

module.exports = { scriptScenes, textFromSection };
