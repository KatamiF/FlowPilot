const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background node registry preserves node metadata even before an executor is registered', () => {
  const source = fs.readFileSync('background/steps/registry.js', 'utf8');
  const api = new Function('self', `${source}; return self.MultiPageBackgroundStepRegistry;`)({});
  const registry = api.createNodeRegistry([
    {
      flowId: 'kiro',
      nodeId: 'kiro-open-register-page',
      displayOrder: 1,
      executeKey: 'kiro-open-register-page',
      title: '打开注册页',
    },
  ]);

  const node = registry.getNodeDefinition('kiro-open-register-page');

  assert.equal(node.flowId, 'kiro');
  assert.equal(node.displayOrder, 1);
  assert.equal(node.title, '打开注册页');
  assert.throws(
    () => registry.executeNode('kiro-open-register-page', {}),
    /Missing node executor: kiro-open-register-page/
  );
});

test('background node registry executes registered nodes in display order', async () => {
  const source = fs.readFileSync('background/steps/registry.js', 'utf8');
  const api = new Function('self', `${source}; return self.MultiPageBackgroundStepRegistry;`)({});
  const events = [];
  const registry = api.createNodeRegistry([
    {
      flowId: 'openai',
      displayOrder: 2,
      nodeId: 'submit-signup-email',
      executeKey: 'submit-signup-email',
      title: 'Submit signup email',
      execute: async (state) => {
        events.push({ type: 'execute', state });
      },
    },
    {
      flowId: 'openai',
      displayOrder: 1,
      nodeId: 'open-chatgpt',
      executeKey: 'open-chatgpt',
      title: 'Open ChatGPT',
    },
  ]);

  assert.deepStrictEqual(
    registry.getOrderedNodes().map((node) => node.nodeId),
    ['open-chatgpt', 'submit-signup-email']
  );

  await registry.executeNode('submit-signup-email', { activeFlowId: 'openai' });

  assert.deepStrictEqual(events, [{ type: 'execute', state: { activeFlowId: 'openai' } }]);
});
