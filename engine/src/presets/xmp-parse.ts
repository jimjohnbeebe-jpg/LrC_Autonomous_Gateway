// A reader for the XMP subset a Lightroom preset file uses: elements, double-quoted attributes and
// text, nothing else (no comments, CDATA, processing instructions or entities beyond the five XML
// ones). Enough to compare the engine's preset files with Lightroom's own
// (tests\presets-reference.test.ts) and to find a preset's name and group (presets\folder.ts). Not a
// general XML parser [inference: the only files it reads are preset .xmp files].

export type XmlNode = { name: string; attrs: Map<string, string>; children: XmlNode[]; text: string };

const TAG = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

export function unescapeXml(s: string): string {
  return s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e] as string);
}

function attributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of source.matchAll(ATTR)) attrs.set(m[1] as string, unescapeXml(m[2] as string));
  return attrs;
}

/** The document's root element. Throws on a closing tag that does not match. */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: new Map(), children: [], text: "" };
  const stack: XmlNode[] = [root];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    const top = stack[stack.length - 1] as XmlNode;
    top.text += text.slice(last, m.index);
    last = m.index + m[0].length;
    const [, closing, name, attrSource, selfClosing] = m as unknown as [string, string, string, string, string];
    if (closing) {
      if (top.name !== name) throw new Error(`XMP: </${name}> closes <${top.name}>`);
      top.text = unescapeXml(top.text.trim());
      stack.pop();
      continue;
    }
    const node: XmlNode = { name, attrs: attributes(attrSource), children: [], text: "" };
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`XMP: <${(stack[stack.length - 1] as XmlNode).name}> is not closed`);
  const first = root.children[0];
  if (!first) throw new Error("XMP: no element");
  return first;
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}

/** The preset's own rdf:Description: x:xmpmeta > rdf:RDF > rdf:Description. */
export function presetDescription(root: XmlNode): XmlNode {
  const rdf = child(root, "rdf:RDF");
  const description = rdf && child(rdf, "rdf:Description");
  if (!description) throw new Error("XMP: no rdf:RDF > rdf:Description");
  return description;
}

/** The x-default entry of an rdf:Alt element such as crs:Name or crs:Group, or null. */
export function altText(node: XmlNode | undefined): string | null {
  const alt = node && child(node, "rdf:Alt");
  const li = alt?.children.find((c) => c.name === "rdf:li" && (c.attrs.get("xml:lang") ?? "x-default") === "x-default");
  return li ? li.text : null;
}

/** The entries of an rdf:Seq element such as crs:ToneCurvePV2012, or null. */
export function seqItems(node: XmlNode | undefined): string[] | null {
  const seq = node && child(node, "rdf:Seq");
  return seq ? seq.children.filter((c) => c.name === "rdf:li").map((c) => c.text) : null;
}

/** A preset file's name and group (the crs:Name and crs:Group of its own description), each null when absent. */
export function presetIdentity(text: string): { name: string | null; group: string | null } {
  const description = presetDescription(parseXml(text));
  return { name: altText(child(description, "crs:Name")), group: altText(child(description, "crs:Group")) };
}
