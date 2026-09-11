const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { Sequelize, DataTypes } = require('sequelize');
const { paginate } = require('../build');

// Use a dedicated test database. Each run owns and removes only its own schema.
const sequelize = new Sequelize(process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5573/postgres', { logging: false });
const schema = `pagination_test_${process.pid}`;
const Item = sequelize.define('Item', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  tenantId: { type: DataTypes.TEXT, allowNull: false, field: 'tenant_id' },
  rank: { type: DataTypes.INTEGER, allowNull: false, field: 'sort_rank' },
  score: { type: DataTypes.INTEGER },
  createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at', defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  title: { type: DataTypes.TEXT, allowNull: false },
}, { schema, tableName: 'items', timestamps: false });
const Project = sequelize.define('Project', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  rank: { type: DataTypes.INTEGER, allowNull: false },
}, { schema, tableName: 'projects', timestamps: false });
Item.belongsTo(Project, { as: 'project' });

before(async () => {
  await sequelize.createSchema(schema);
  await sequelize.sync();
  await Project.bulkCreate([{ id: 1, rank: 2 }, { id: 2, rank: 1 }]);
  await Item.bulkCreate(Array.from({ length: 24 }, (_, i) => ({
    id: i + 1, tenantId: 'a', rank: Math.floor(i / 3),
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(i / 3))),
    score: i % 3 === 0 ? null : Math.floor(i / 4), title: `title '${i}`, projectId: i % 2 + 1,
  })));
  await Item.create({ id: 25, tenantId: 'other', rank: 1, score: 1, title: 'other', projectId: 1 });
});
after(async () => {
  await sequelize.dropSchema(schema, { cascade: true });
  await sequelize.close();
});

async function checkPages(order, options = {}) {
  const query = { where: { tenantId: 'a' }, order, ...options };
  const expected = (await Item.findAll(query)).map(row => row.id);
  const pages = [];
  let cursor;

  do {
    const [rows, cursors, count] = await paginate(Item, { ...query, cursor, limit: 4, includeTotalCount: true });
    assert.equal(count, expected.length, 'Total must describe all matches on every page');
    assert(rows.length > 0);
    pages.push({ rows: rows.map(row => row.id), cursors });
    assert(pages.length <= expected.length, 'Pagination must advance');
    cursor = cursors.hasNext ? cursors.next : undefined;
  } while (cursor);

  assert.deepEqual(pages.flatMap(page => page.rows), expected);
  for (let i = pages.length - 1; i > 0; i--) {
    const [rows, cursors] = await paginate(Item, { ...query, cursor: pages[i].cursors.previous, limit: 4 });
    assert.deepEqual(rows.map(row => row.id), pages[i - 1].rows, 'Backward pages must match forward pages');
    assert.equal(cursors.hasPrevious, i > 1);
  }
}

for (const direction of ['ASC', 'DESC', 'ASC NULLS FIRST', 'ASC NULLS LAST', 'DESC NULLS FIRST', 'DESC NULLS LAST']) {
  test(`non-null composite cursor: ${direction}`, () => checkPages([['rank', direction], ['id', direction]]));
  test(`nullable composite cursor: ${direction}`, () => checkPages([['score', direction], ['id', direction]]));
}
test('date cursor values', () => checkPages([['createdAt', 'DESC'], ['id', 'DESC']]));
test('mixed nullable directions', () => checkPages([['score', 'DESC NULLS LAST'], ['id', 'ASC']]));
test('mixed directions', () => checkPages([['rank', 'ASC'], ['id', 'DESC']]));
test('lowercase directions', () => checkPages([['rank', 'desc'], ['id', 'desc']]));
test('quoted string values', () => checkPages([['title', 'ASC'], ['id', 'ASC']]));
test('expression alias preserves its own ordering', () => checkPages([['rank', 'ASC'], ['id', 'ASC']], {
  attributes: ['id', [sequelize.literal('-sort_rank'), 'rank']],
}));
test('nullable expression aliases retain blank/null rows across pages', () => checkPages([['sortScore', 'DESC NULLS LAST'], ['id', 'DESC']], {
  attributes: ['id', [sequelize.fn('NULLIF', sequelize.col('score'), 0), 'sortScore']],
}));
test('joined ordering', () => checkPages([['project', 'rank', 'ASC'], ['id', 'ASC']], {
  include: [{ model: Project, as: 'project', required: true }],
}));
test('counts remain optional and empty filters return zero', async () => {
  const [rows, , count] = await paginate(Item, { where: { tenantId: 'missing' }, order: [['id', 'ASC']], limit: 4, includeTotalCount: true });
  assert.equal(rows.length, 0);
  assert.equal(count, 0);
  const [, , omitted] = await paginate(Item, { where: { tenantId: 'a' }, order: [['id', 'ASC']], limit: 4 });
  assert.equal(omitted, undefined);
});

test('deep composite pages use an index bound and preserve full totals', async () => {
  await sequelize.query(`INSERT INTO "${schema}".items (id, tenant_id, sort_rank, title)
    SELECT n, 'large', n / 3, 'generated' FROM generate_series(100, 50100) n`);
  await sequelize.query(`CREATE INDEX items_tenant_rank_id ON "${schema}".items (tenant_id, sort_rank, id)`);
  await sequelize.query(`ANALYZE "${schema}".items`);
  let pageSql;
  const [rows, , total] = await paginate(Item, {
    where: { tenantId: 'large' }, order: [['rank', 'ASC'], ['id', 'ASC']],
    cursor: [true, [15000, 45000]], limit: 10, includeTotalCount: true,
    logging: sql => { if (!sql.includes('count(')) { pageSql = sql.replace(/^Executing \([^)]*\): /, ''); } },
  });
  assert.equal(rows[0].id, 45001);
  assert.equal(total, 50001);
  const [plans] = await sequelize.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${pageSql}`);
  const plan = plans[0]['QUERY PLAN'][0];
  const nodes = [];
  function visit(node) { nodes.push(node); (node.Plans || []).forEach(visit); }
  visit(plan.Plan);
  const scan = nodes.find(node => node['Index Name'] === 'items_tenant_rank_id');
  assert(scan, 'The page must use the matching index');
  console.log(JSON.stringify({ executionMs: plan['Execution Time'], buffers: plan.Plan['Shared Hit Blocks'], indexCondition: scan['Index Cond'], removedRows: scan['Rows Removed by Filter'] || 0 }));
  assert.match(scan['Index Cond'], /ROW\(sort_rank, id\)/, 'The cursor must be an index bound');
  assert((scan['Rows Removed by Filter'] || 0) < 20, 'Must not walk tens of thousands of earlier rows');
});
