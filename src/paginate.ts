import { Attributes, Model, ModelStatic, Op, Sequelize, WhereOptions, Order } from 'sequelize';

import { DIRECTION_DESC, DIRECTION_ASC, DIRECTION_NULLS_LAST, DIRECTION_NULLS_FIRST } from './constants';
import { AliasMap, Cursors, PaginateOptions, PaginateWithoutTotalCountOptions, PaginateWithTotalCountOptions } from './types';
import { getDirection, normalizeOrderKey, deepGet, getColumnReference } from './utils';

const DIRECTION_OPTIONS = [DIRECTION_DESC, DIRECTION_ASC, `${DIRECTION_DESC} ${DIRECTION_NULLS_LAST}`, `${DIRECTION_DESC} ${DIRECTION_NULLS_FIRST}`, `${DIRECTION_ASC} ${DIRECTION_NULLS_LAST}`, `${DIRECTION_ASC} ${DIRECTION_NULLS_FIRST}`];

// Row comparisons let PostgreSQL seek directly into a matching composite index.
// Nullable columns and expressions must keep the general cursor predicate below.
function getTupleCursorWhere<M extends Model>(
  model: ModelStatic<M>,
  order: string[][],
  values: unknown[],
  aliasMap: AliasMap,
) {
  const sequelize = model.sequelize!;
  const attributes = model.getAttributes();
  const direction = order[0]?.[1].split(' ')[0];

  if (
    sequelize.getDialect() !== 'postgres' ||
    order.length < 2 ||
    values.length !== order.length ||
    order.some(([column, columnDirection], i) => {
      const attribute = attributes[column];

      return column.includes('.') || aliasMap[column] !== undefined || !attribute ||
        (attribute.allowNull !== false && !attribute.primaryKey) ||
        columnDirection.split(' ')[0] !== direction ||
        values[i] == null ||
        (!['string', 'number'].includes(typeof values[i]) && !(values[i] instanceof Date));
    })
  ) {
    return undefined;
  }

  const queryInterface = sequelize.getQueryInterface();
  const columns = order.map(([column]) => {
    return `${queryInterface.quoteIdentifier(model.name)}.${queryInterface.quoteIdentifier(attributes[column].field ?? column)}`;
  });
  const operator = direction === DIRECTION_DESC ? '<' : '>';

  return Sequelize.literal(`(${columns.join(', ')}) ${operator} (${values.map(value => sequelize.escape(value as string | number | Date)).join(', ')})`);
}

export async function paginate<
  M extends Model<TModelAttributes, TCreationAttributes>,
  TModelAttributes extends Record<string, any> = any,
  TCreationAttributes extends Record<string, any> = TModelAttributes
>(model: ModelStatic<M>, options: PaginateWithTotalCountOptions<Attributes<M>>): Promise<[M[], Cursors, number]>;

export async function paginate<
  M extends Model<TModelAttributes, TCreationAttributes>,
  TModelAttributes extends Record<string, any> = any,
  TCreationAttributes extends Record<string, any> = TModelAttributes
>(model: ModelStatic<M>, options: PaginateWithoutTotalCountOptions<Attributes<M>>): Promise<[M[], Cursors, undefined]>;

export async function paginate<
  M extends Model<TModelAttributes, TCreationAttributes>,
  TModelAttributes extends Record<string, any> = any,
  TCreationAttributes extends Record<string, any> = TModelAttributes
>(model: ModelStatic<M>, { cursor, includeTotalCount, attributes, where, order, limit, ...rest }: PaginateOptions<Attributes<M>> = {}): Promise<[M[], Cursors, number | undefined]> {
  const [isNext, cursorData] = cursor ?? [true, undefined];
  const fullWhere: WhereOptions<Attributes<M>>[] = [];
  const fullOrder = (order ? Array.isArray(order) ? order : [order] : []).map((orderItem) => {
    const orderArr = Array.isArray(orderItem) ? [...orderItem] : [orderItem];
    const originalDirection = DIRECTION_OPTIONS.includes(String(orderArr[orderArr.length - 1]).toUpperCase()) ? (orderArr.pop() as string).toUpperCase() : DIRECTION_ASC;
    const direction = getDirection(originalDirection, isNext);

    return [orderArr.map(normalizeOrderKey).join('.'), direction];
  });

  if (where) {
    fullWhere.push(where);
  }

  if (cursorData) {
    const aliasMap: AliasMap = {};

    for (const attribute of (Array.isArray(attributes) ? attributes : attributes?.include ? attributes.include : [])) {
      if (Array.isArray(attribute)) {
        const [col, alias] = attribute;

        aliasMap[alias] = col;
      }
    }

    const tupleCursorWhere = getTupleCursorWhere(model, fullOrder, cursorData, aliasMap);

    fullWhere.push(tupleCursorWhere ?? {
      [Op.or]: fullOrder.flatMap(([orderKey, direction], i: number) => {
        const columnReference = getColumnReference(model, aliasMap, orderKey);
        const equals: string[][] = fullOrder.slice(0, i);
        const cursorValue = cursorData[i];
        const notEqualsSection: WhereOptions<Attributes<M>>[] = [];
        const operator = direction.startsWith(DIRECTION_DESC) ? Op.lt : Op.gt;
        const nullsLast = direction.endsWith(DIRECTION_NULLS_LAST) ||
          (!direction.endsWith(DIRECTION_NULLS_FIRST) && direction.startsWith(DIRECTION_ASC));

        if (cursorValue == null) {
          if (nullsLast) {
            // Nothing follows NULL at this key; later keys still break ties.
            return [];
          }

          notEqualsSection.push(Sequelize.where(columnReference, Op.not, null));
        } else {
          const notEqualsSectionOr: WhereOptions<Attributes<M>>[] = [Sequelize.where(columnReference, operator, cursorValue)];

          if (nullsLast && (aliasMap[orderKey] !== undefined || !model.primaryKeyAttributes.includes(orderKey))) {
            notEqualsSectionOr.push(Sequelize.where(columnReference, Op.is, null));
          }

          notEqualsSection.push({
            [Op.or]: notEqualsSectionOr
          });
        }

        return [{
          [Op.and]: equals
            .map(([equalsOrderKey], i): WhereOptions<Attributes<M>> => {
              return Sequelize.where(
                getColumnReference(model, aliasMap, equalsOrderKey),
                Op.eq,
                cursorData[i]
              );
            })
            .concat(notEqualsSection),
        }];
      }),
    });
  }

  const promises: [Promise<M[]>, Promise<number | undefined>] = [
    model.findAll({
      where: fullWhere.length ? { [Op.and]: fullWhere } : undefined,
      order: fullOrder.length ? fullOrder.map(([orderKey, direction]) => [...orderKey.split('.'), direction]) as Order : undefined,
      attributes,
      limit: limit != null ? limit + 1 : undefined,
      ...rest
    }),
    includeTotalCount ? model.count({
      where,
      ...rest,
    }) : Promise.resolve(undefined)
  ];

  const [rows, totalCount] = await Promise.all(promises);
  const hasMore = limit != null ? rows.length > limit : false;

  if (hasMore) {
    rows.pop();
  }

  if (!isNext) {
    rows.reverse();
  }

  const firstItem = rows[0];
  const lastItem = rows[rows.length - 1];

  return [
    rows,
    {
      next: lastItem ? [true, fullOrder.map(([orderKey]) => deepGet(lastItem.get({ plain: true }), orderKey.split('.'), null))] : undefined,
      previous: firstItem ? [false, fullOrder.map(([orderKey]) => deepGet(firstItem.get({ plain: true }), orderKey.split('.'), null))] : undefined,
      hasNext: (isNext && hasMore) || !isNext,
      hasPrevious: (!isNext && hasMore) || (isNext && cursorData != null),
    },
    totalCount
  ];
}
