export async function load(url, context, nextLoad) {
  if (/\.(png|jpe?g|webp|svg)$/i.test(new URL(url).pathname)) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(url)};`,
    };
  }

  return nextLoad(url, context);
}
