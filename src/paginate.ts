import { Attributes, Model, ModelStatic, Op, Sequelize, WhereOptions, Order } from 'sequelize';

import { DIRECTION_DESC, DIRECTION_ASC, DIRECTION_NULLS_LAST, DIRECTION_NULLS_FIRST } from './constants';
import { AliasMap, Cursors, PaginateOptions, PaginateWithoutTotalCountOptions, PaginateWithTotalCountOptions } from './types';
import { getDirection, normalizeOrderKey, deepGet, getColumnReference } from './utils';

const DIRECTION_OPTIONS = [DIRECTION_DESC, DIRECTION_ASC, `${DIRECTION_DESC} ${DIRECTION_NULLS_LAST}`, `${DIRECTION_DESC} ${DIRECTION_NULLS_FIRST}`, `${DIRECTION_ASC} ${DIRECTION_NULLS_LAST}`, `${DIRECTION_ASC} ${DIRECTION_NULLS_FIRST}`];

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
    const originalDirection = DIRECTION_OPTIONS.includes(String(orderArr[orderArr.length - 1]).toUpperCase()) ? orderArr.pop() as string : DIRECTION_ASC;
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

    fullWhere.push({
      [Op.or]: fullOrder.map(([orderKey, direction], i: number) => {
        const columnReference = getColumnReference(model, aliasMap, orderKey);
        const equals: string[][] = fullOrder.slice(0, i);
        const cursorValue = cursorData[i];
        const notEqualsSection: WhereOptions<Attributes<M>>[] = [];
        const operator = direction.startsWith(DIRECTION_DESC) ? Op.lt : Op.gt;
        const nullsLast = direction.startsWith(DIRECTION_DESC) || direction.endsWith(DIRECTION_NULLS_LAST);

        if (cursorValue == null && nullsLast) {
          notEqualsSection.push(Sequelize.where(columnReference, Op.not, cursorValue));
        } else if (cursorValue != null) {
          const notEqualsSectionOr: WhereOptions<Attributes<M>>[] = [Sequelize.where(columnReference, operator, cursorValue)];

          if (!nullsLast && !model.primaryKeyAttributes.includes(orderKey)) {
            notEqualsSectionOr.push(Sequelize.where(columnReference, Op.is, null));
          }

          notEqualsSection.push({
            [Op.or]: notEqualsSectionOr
          });
        }

        return {
          [Op.and]: equals
            .map(([equalsOrderKey], i): WhereOptions<Attributes<M>> => {
              return Sequelize.where(
                getColumnReference(model, aliasMap, equalsOrderKey),
                Op.eq,
                cursorData[i]
              );
            })
            .concat(notEqualsSection),
        };
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

  const firstItem = rows[0];
  const lastItem = rows[rows.length - 1];

  return [
    isNext ? rows : rows.reverse(),
    {
      next: lastItem ? [true, fullOrder.map(([orderKey]) => deepGet(lastItem.get({ plain: true }), orderKey.split('.'), null))] : undefined,
      previous: firstItem ? [false, fullOrder.map(([orderKey]) => deepGet(firstItem.get({ plain: true }), orderKey.split('.'), null))] : undefined,
      hasNext: (isNext && hasMore) || !isNext,
      hasPrevious: (!isNext && hasMore) || (isNext && cursorData != null),
    },
    totalCount
  ];
}
