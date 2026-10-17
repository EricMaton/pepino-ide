import { describe, expect, it } from 'vitest';
import { createSandbox, DEFAULT_SANDBOX_OPTIONS, type SandboxHost } from '../../features/plugins/sandbox';
import main from './main.js?raw';

/*
 * The formatter plugin (#51) as the app runs it: its main.js, js-beautify
 * included, in the sandbox with the app's own deadline and memory limit.
 */
async function formatFile(path: string, text: string, indentSize = 2) {
  const messages: string[] = [];
  let written: string | null = null;
  const host: SandboxHost = {
    async call(method, args) {
      switch (method) {
        case 'editor.getPath':
          return path;
        case 'editor.getText':
          return text;
        case 'editor.setText':
          written = String(args[0]);
          return undefined;
        case 'window.showMessage':
          messages.push(String(args[0]));
          return undefined;
      }
      throw new Error(`No ${method} here`);
    },
    log: () => undefined,
  };
  const sandbox = await createSandbox(main, { indentSize }, host, DEFAULT_SANDBOX_OPTIONS);
  try {
    await sandbox.activate();
    await sandbox.runCommand('format');
  } finally {
    sandbox.dispose();
  }
  return { written: written as string | null, messages };
}

describe('formatter plugin (#51)', () => {
  it('formats JavaScript, keeping one-line blocks and regular expressions as they are', async () => {
    const { written } = await formatFile(
      'app/src/sum.js',
      "import {a,b} from './x.js';\nconst sum=(xs)=>xs.reduce((t,x)=>t+x,0);\nif(a){b()}else{\nreturn /[{}]/g\n}",
    );
    expect(written).toBe(
      "import { a, b } from './x.js';\nconst sum = (xs) => xs.reduce((t, x) => t + x, 0);\nif (a) { b() } else {\n  return /[{}]/g\n}\n",
    );
  });

  it('formats CSS, with the indent its setting asks for', async () => {
    const { written } = await formatFile(
      'site/style.css',
      'body{margin:0}@media (max-width:600px){.a{display:none}}',
      4,
    );
    expect(written).toBe(
      'body {\n    margin: 0\n}\n\n@media (max-width:600px) {\n    .a {\n        display: none\n    }\n}\n',
    );
  });

  it('formats HTML, and the CSS and JavaScript inside it', async () => {
    const { written } = await formatFile(
      'site/index.html',
      '<html><head><style>body{margin:0}</style></head><body><ul><li>a</li></ul><script>const x={a:1};go(x)</script></body></html>',
    );
    expect(written).toBe(
      [
        '<html>',
        '<head>',
        '  <style>',
        '    body {',
        '      margin: 0',
        '    }',
        '  </style>',
        '</head>',
        '<body>',
        '  <ul>',
        '    <li>a</li>',
        '  </ul>',
        '  <script>',
        '    const x = { a: 1 };',
        '    go(x)',
        '  </script>',
        '</body>',
        '</html>',
        '',
      ].join('\n'),
    );
  });

  it('says so when the file is formatted already, and writes nothing', async () => {
    const { written, messages } = await formatFile('a.js', 'const a = 1;\n');
    expect(written).toBeNull();
    expect(messages).toEqual(['Already formatted']);
  });

  it('leaves TypeScript and other files alone, and says why', async () => {
    const typescript = await formatFile('app/use.ts', 'const [a, setA] = useState<number>(0);');
    expect(typescript).toEqual({ written: null, messages: ['TypeScript is not supported yet'] });
    const markdown = await formatFile('README.md', '# Hi');
    expect(markdown).toEqual({ written: null, messages: ["It can't format README.md"] });
  });
});
