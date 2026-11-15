// Decorative art. Everything drawn here is also available as text on the page,
// so it is hidden from assistive technology.

const cakeGlyphs = ["░", "▒", "▓", "█", "#"];
const sampleLayers = [{ label: "", amount: 2 }, { label: "", amount: 5 }, { label: "", amount: 9 }];
const maxLayers = 5;

// Largest categories become cake layers, smallest on top; width follows the amount.
function cakeLayers(items) {
  const layers = items.filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, maxLayers).reverse();
  const largest = Math.max(...layers.map((layer) => layer.amount), 1);
  return layers.map((layer, index) => ({ ...layer, index, share: Math.sqrt(layer.amount / largest) }));
}

function asciiCake(layers) {
  const widths = layers.map((layer) => 7 + 2 * Math.round(layer.share * 10));
  const total = Math.max(...widths) + 6;
  const center = (line) => " ".repeat(Math.floor((total - line.length) / 2)) + line;
  const lines = [center("."), center("|")];
  layers.forEach((layer, index) => {
    const fill = cakeGlyphs[layer.index % cakeGlyphs.length].repeat(widths[index]);
    lines.push(center(`.${"-".repeat(widths[index])}.`), center(`|${fill}|`), center(`|${fill}|`));
  });
  lines.push(center(`'${"-".repeat(widths[widths.length - 1])}'`), "=".repeat(total));
  return lines.join("\n");
}

function blockCake(layers) {
  const cake = document.createElement("div");
  cake.className = "block-cake";
  const cherry = document.createElement("span");
  cherry.className = "cherry";
  cake.append(cherry);
  layers.forEach((layer) => {
    const block = document.createElement("span");
    block.className = `layer layer-${layer.index % maxLayers}`;
    block.style.width = `${Math.round(30 + layer.share * 70)}%`;
    cake.append(block);
  });
  return cake;
}

// Landing page art: flat discs in the dark, the block cake in the light.
function renderLandingArt(container, theme) {
  if (theme === "cake") {
    container.replaceChildren(blockCake(cakeLayers(sampleLayers)));
    return;
  }
  const orbs = document.createElement("div");
  orbs.className = "orbs";
  ["ring", "ring", "ring", "disc-outer", "disc-inner"].forEach((name) => {
    const part = document.createElement("span");
    part.className = name;
    orbs.append(part);
  });
  container.replaceChildren(orbs);
}

function renderCake(container, items, theme) {
  const layers = cakeLayers(items.length ? items : sampleLayers);
  if (theme === "cake") {
    container.replaceChildren(blockCake(layers));
    return layers;
  }
  const pre = document.createElement("pre");
  pre.textContent = asciiCake(layers);
  container.replaceChildren(pre);
  return layers;
}

// Slow field of ledger glyphs, denser toward the bottom of the screen.
function startGlyphField(canvas) {
  const context = canvas.getContext("2d");
  const glyphs = "0123456789$[]{}&+%".split("");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let particles = [];
  let width = 0;
  let height = 0;
  let color = "233, 166, 80";
  let previous = 0;
  let frame = 0;

  const spawn = (anywhere) => ({
    x: Math.random() * width,
    y: anywhere ? Math.random() * height : height + 24,
    speed: 4 + Math.random() * 10,
    drift: (Math.random() - 0.5) * 4,
    size: 11 + Math.random() * 10,
    alpha: 0.1 + Math.random() * 0.35,
    glyph: glyphs[Math.floor(Math.random() * glyphs.length)]
  });

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    particles = Array.from({ length: Math.min(90, Math.round((width * height) / 14000)) }, () => spawn(true));
    draw(0);
  }

  function draw(seconds) {
    context.clearRect(0, 0, width, height);
    context.textAlign = "center";
    particles.forEach((particle, index) => {
      particle.y -= particle.speed * seconds;
      particle.x += particle.drift * seconds;
      if (particle.y < -24) particles[index] = spawn(false);
      const depth = Math.max(0, particle.y / height);
      context.font = `${particle.size}px ui-monospace, Menlo, Consolas, monospace`;
      context.fillStyle = `rgba(${color}, ${(particle.alpha * depth * depth).toFixed(3)})`;
      context.fillText(particle.glyph, particle.x, particle.y);
    });
  }

  function tick(time) {
    const visible = !document.hidden && getComputedStyle(canvas).display !== "none";
    if (visible) draw(Math.min(0.1, (time - previous) / 1000));
    previous = time;
    frame = requestAnimationFrame(tick);
  }

  window.addEventListener("resize", resize);
  resize();
  if (!still) frame = requestAnimationFrame(tick);

  return {
    recolor() {
      color = getComputedStyle(document.documentElement).getPropertyValue("--glyph").trim() || color;
      draw(0);
    },
    stop() { cancelAnimationFrame(frame); }
  };
}
