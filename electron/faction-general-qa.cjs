const fs = require('fs');
const path = require('path');

const FACTION_GENERAL_STEMS = Object.freeze({
  aegis: 'aegis_general',
  synod: 'synod_general',
  veyra: 'veyra_general',
});

function getBuiltFactionGeneralAssets(root) {
  const assetDirectory = path.join(root, 'dist', 'assets');
  const files = fs.readdirSync(assetDirectory);
  return Object.entries(FACTION_GENERAL_STEMS).map(([faction, stem]) => {
    const file = files.find((candidate) => candidate.startsWith(`${stem}-`) && candidate.endsWith('.png'));
    if (!file) throw new Error(`Built faction general asset is missing: ${stem}`);
    return { faction, stem, file };
  });
}

async function inspectFactionGeneralAssets(win, assets) {
  return win.webContents.executeJavaScript(`(async () => {
    const entries = ${JSON.stringify(assets)};
    const inspect = async (entry) => {
      const image = new Image();
      image.src = new URL('assets/' + entry.file, window.location.href).href;
      if (!image.complete) await new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
      if (image.decode) await image.decode().catch(() => {});
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.width && canvas.height ? canvas.getContext('2d', { willReadFrequently: true }) : null;
      let transparentPixels = 0;
      let fullyTransparentPixels = 0;
      if (context) {
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] < 255) transparentPixels += 1;
          if (pixels[index] === 0) fullyTransparentPixels += 1;
        }
      }
      return {
        faction: entry.faction,
        stem: entry.stem,
        file: entry.file,
        width: image.naturalWidth,
        height: image.naturalHeight,
        transparentPixels,
        fullyTransparentPixels,
      };
    };
    return Promise.all(entries.map(inspect));
  })()`);
}

async function inspectRenderedFactionGeneralPortraits(win, selector) {
  return win.webContents.executeJavaScript(`(async () => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const waitForImage = async (image) => {
      if (!image) return;
      if (!image.complete) await new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
      if (image.decode) await image.decode().catch(() => {});
    };
    const inspect = async (node) => {
      const image = node.querySelector('img');
      await waitForImage(image);
      const canvas = document.createElement('canvas');
      canvas.width = image?.naturalWidth || 0;
      canvas.height = image?.naturalHeight || 0;
      const context = canvas.width && canvas.height ? canvas.getContext('2d', { willReadFrequently: true }) : null;
      let transparentPixels = 0;
      let fullyTransparentPixels = 0;
      if (context) {
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] < 255) transparentPixels += 1;
          if (pixels[index] === 0) fullyTransparentPixels += 1;
        }
      }
      const portraitStyle = getComputedStyle(node);
      const parent = node.parentElement;
      const parentStyle = parent ? getComputedStyle(parent) : null;
      const src = image?.currentSrc || image?.src || '';
      return {
        faction: node.getAttribute('data-faction') || '',
        asset: node.getAttribute('data-asset') || '',
        assetFile: src.split('/').pop()?.split('?')[0] || '',
        imageFound: Boolean(image && image.complete && image.naturalWidth > 0),
        width: image?.naturalWidth || 0,
        height: image?.naturalHeight || 0,
        transparentPixels,
        fullyTransparentPixels,
        backgroundImage: portraitStyle.backgroundImage,
        backgroundColor: portraitStyle.backgroundColor,
        parentClass: typeof parent?.className === 'string' ? parent.className : '',
        parentBackgroundImage: parentStyle?.backgroundImage || '',
        parentBackgroundColor: parentStyle?.backgroundColor || '',
      };
    };
    return Promise.all(nodes.map(inspect));
  })()`);
}

function isTransparentColor(value) {
  return value === 'rgba(0, 0, 0, 0)' || value === 'transparent';
}

function assertBuiltFactionGeneralAssets(snapshot, label) {
  const expected = Object.keys(FACTION_GENERAL_STEMS);
  if (snapshot.length !== expected.length || snapshot.some((item) => !expected.includes(item.faction))) {
    throw new Error(`${label}: faction general asset catalog mismatch ${JSON.stringify(snapshot)}`);
  }
  for (const item of snapshot) {
    if (!item.file.includes(FACTION_GENERAL_STEMS[item.faction]) || !item.width || !item.height || !item.transparentPixels) {
      throw new Error(`${label}: faction general asset is not a transparent PNG ${JSON.stringify(item)}`);
    }
  }
}

function assertRenderedFactionGeneralPortraits(snapshot, expectedFactions, label) {
  if (snapshot.length !== expectedFactions.length) {
    throw new Error(`${label}: rendered faction portrait count mismatch ${JSON.stringify({ expectedFactions, snapshot })}`);
  }
  snapshot.forEach((item, index) => {
    const expectedFaction = expectedFactions[index];
    const expectedAsset = `${FACTION_GENERAL_STEMS[expectedFaction]}.png`;
    if (item.faction !== expectedFaction || item.asset !== expectedAsset || !item.assetFile.includes(FACTION_GENERAL_STEMS[expectedFaction])) {
      throw new Error(`${label}: wrong faction general asset ${JSON.stringify({ expectedFaction, item })}`);
    }
    if (!item.imageFound || !item.width || !item.height || !item.transparentPixels) {
      throw new Error(`${label}: rendered faction general is not a transparent PNG ${JSON.stringify(item)}`);
    }
    if (item.backgroundImage !== 'none' || !isTransparentColor(item.backgroundColor)) {
      throw new Error(`${label}: faction portrait has a background ${JSON.stringify(item)}`);
    }
    if (item.parentBackgroundImage !== 'none' || !isTransparentColor(item.parentBackgroundColor)) {
      throw new Error(`${label}: faction portrait container has a background ${JSON.stringify(item)}`);
    }
  });
}

module.exports = {
  FACTION_GENERAL_STEMS,
  assertBuiltFactionGeneralAssets,
  assertRenderedFactionGeneralPortraits,
  getBuiltFactionGeneralAssets,
  inspectFactionGeneralAssets,
  inspectRenderedFactionGeneralPortraits,
};
