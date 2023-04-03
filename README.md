# sequelize-cursor-pagination

[![npm](https://img.shields.io/npm/v/@unthread-io/sequelize-cursor-pagination)](https://www.npmjs.com/package/@unthread-io/sequelize-cursor-pagination)

Cursor (aka keyset) pagination for Sequelize.

## Install

With npm:

```bash
npm install sequelize-cursor-pagination
```

## Usage

This package is written in Typescript.

```typescript
import { paginate } from "sequelize-cursor-pagination";

const Task = sequelize.define("task", {
  id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
  title: Sequelize.TEXT,
});

const [rows, cursors, totalCount] = await paginate(Task, {
  limit: 20,
  includeTotalCount: true,
  order: ["id", "ASC"],
});

const [nextRows, nextCursors] = await paginate(Task, {
  limit: 20,
  order: ["id", "ASC"],
  cursor: cursors.next,
});

const [prewiousRows, previousCursors] = await paginate(Task, {
  limit: 20,
  order: ["id", "ASC"],
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
- You should include the primary key or another unique column as the last column
  to order by. This library will not do that for you.

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
  `order: [Subtask, 'id', 'ASC']` will work but
  `order: [fn('upper', col('id')), 'ASC']` will not. In order to achieve the
  second example, add `fn('upper', col('id'))` as an attribute with an alias and
  order on the alias.
