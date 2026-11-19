/* denelli dungeon - tiny WebAudio synth. Every sound is generated in code,
   no audio files, no borrowed assets. The settings toggle truly mutes this
   module; state persists in localStorage (default: on). */
(function () {
  let ctx = null;
  let enabled = true;
  try { enabled = localStorage.getItem('denelli-sound') !== 'off'; } catch (e) {}
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function blip(freq, dur, type, vol, slide) {
    if (!enabled) return;
    const c = ac(); if (!c) return;
    try {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, c.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), c.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.06, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + dur);
    } catch (e) {}
  }
  window.NelliSfx = {
    isOn: () => enabled,
    set(on) { enabled = !!on; try { localStorage.setItem('denelli-sound', enabled ? 'on' : 'off'); } catch (e) {} },
    unlock() { ac(); }, // browsers need one user gesture before audio can start
    shoot() { blip(880, 0.09, 'square', 0.05, -500); },
    slash() { blip(300, 0.05, 'square', 0.035, -120); },
    hit() { blip(220, 0.07, 'sawtooth', 0.05, -80); },
    kill() { blip(520, 0.18, 'triangle', 0.07, 340); },
    hurt() { blip(140, 0.22, 'sawtooth', 0.07, -60); },
    gold() { blip(990, 0.08, 'sine', 0.05, 220); },
    heal() { blip(660, 0.12, 'sine', 0.05, 160); },
    stairs() { blip(330, 0.25, 'triangle', 0.06, 330); },
    rebirth() { blip(440, 0.3, 'sine', 0.06, 440); },
  };
})();
