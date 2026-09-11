# sequelize-cursor-pagination

[![npm](https://img.shields.io/npm/v/@unthread-io/sequelize-cursor-pagination)](https://www.npmjs.com/package/@unthread-io/sequelize-cursor-pagination)

Cursor (aka keyset) pagination for Sequelize.

## Install

With npm:

```bash
npm install @unthread-io/sequelize-cursor-pagination
```

## Usage

This package is written in Typescript.

```typescript
import { paginate } from "@unthread-io/sequelize-cursor-pagination";

const Task = sequelize.define("task", {
  id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  title: Sequelize.TEXT,
});

const [rows, cursors, totalCount] = await paginate(Task, {
  limit: 20,
  includeTotalCount: true,
  order: [["id", "ASC"]],
});

const [nextRows, nextCursors] = await paginate(Task, {
  limit: 20,
  order: [["id", "ASC"]],
  cursor: cursors.next,
});

const [previousRows, previousCursors] = await paginate(Task, {
  limit: 20,
  order: [["id", "ASC"]],
  cursor: cursors.previous,
});
```

The `paginate` function returns a tuple of the data from Sequelize and an object
containing cursors to the next and previous pages. This object also includes
`hasNext` and `hasPrevious` boolean properties. The function wraps `findAll` and
accepts the same options. In addition, it also accepts the following options:

- `includeTotalCount` - Whether to include the full count of rows matching the
  query without considering pagination. Optional since this can be expensive.
- `cursor` - A cursor to the next or previous page.

In order for this function to work as expected, you must follow these
guidelines:

- When passing a cursor, you should pass the same `order` property as the
  original query.
- The columns you are ordering on should be selected as part of the query.
- The complete `order` must uniquely identify each result row. Append a non-null
  primary key or another non-null unique key to break ties. For a composite key,
  include every component needed for uniqueness within the filtered result set.
  This library does not append tiebreakers automatically. For example, use
  `order: [["score", "ASC"], ["name", "ASC"], ["id", "ASC"]]` when `score`
  and `name` can repeat or be NULL. Without a unique ordering, rows that share
  all cursor values cannot be distinguished and may be skipped across pages.
- Use nested arrays for order items, such as `order: [["id", "ASC"]]`.
  The flat form `order: ["id", "ASC"]` is currently unsupported at runtime,
  even though the TypeScript types accept it.

Note also that this library will allow you to order on columns of included
models as well as on functions (by referencing the alias in the `order`). In
order to get the full benefits of cursor pagination, you should create indexes
on any columns or combination of columns you plan or ordering on.

## Limitations

- Has only been tested on Postgres.
- Has not been tested with the `group` property of `findAll`.
- Does not support ordering on nested properties that are aliased.
- Not all types supported in `order` by `findAll` are supported by `paginate`.
  You can only order on strings, column references, or models. For example,
  `order: [[Subtask, 'id', 'ASC']]` will work but
  `order: [[fn('upper', col('id')), 'ASC']]` will not. In order to achieve the
  second example, add `fn('upper', col('id'))` as an attribute with an alias and
  order on the alias.

## PostgreSQL cursor optimization

For two or more non-null model columns ordered in the same direction, pagination
uses a row comparison such as `(created_at, id) < (cursor_date, cursor_id)`. This
allows PostgreSQL to seek into a matching composite index on deep pages. Nullable
columns, mixed directions, joined columns, and expression aliases use the general
cursor predicate. The optimization changes only page filters; requested totals
still cover the original query.

The optimization determines nullability from Sequelize model metadata
(`allowNull: false` or `primaryKey: true`); it does not introspect database
constraints. These declarations must match the actual database schema. A model
marked non-null over a column that can contain NULL may cause rows to be omitted
by the tuple comparison. When using migrations or defining models over existing
tables, verify that the non-null declarations are backed by database constraints
and keep both in sync. Nullable columns must remain declared nullable so they
use the general cursor predicate.

## Tests

Run `npm ci`, then start a dedicated test database:

```sh
docker run --rm --name cursor-pagination-test -p 127.0.0.1:5573:5432 \
  -e POSTGRES_PASSWORD=postgres postgres:15-alpine
```

In another terminal, run `npm test`. To use another dedicated test database, set
`TEST_DATABASE_URL`. Tests create and remove an isolated schema and verify both
pagination results and PostgreSQL index use. Run `npm run check` for type checking.
