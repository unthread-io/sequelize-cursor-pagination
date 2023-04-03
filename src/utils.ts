import { Utils, Sequelize, Model, ModelStatic } from 'sequelize';

import { DIRECTION_DESC, DIRECTION_NULLS_LAST, DIRECTION_ASC, DIRECTION_NULLS_FIRST } from './constants';
import { AliasMap, OrderItemColumn } from './types';

export function deepGet<T>(obj: any, path: string[], def: T) {
  return path.reduce((acc, key) => {
    if (acc == null) {
      return def;
    }

    return acc[key];
  }, obj);
}

export function getDirection(originalDirection: string, isNext: boolean) {
  const descending = originalDirection.startsWith(DIRECTION_DESC);
  const nullsLast = originalDirection.endsWith(DIRECTION_NULLS_LAST);

  if (isNext) {
    return originalDirection;
  }

  return originalDirection.replace(descending ? DIRECTION_DESC : DIRECTION_ASC, descending ? DIRECTION_ASC : DIRECTION_DESC).replace(nullsLast ? DIRECTION_NULLS_LAST : DIRECTION_NULLS_FIRST, nullsLast ? DIRECTION_NULLS_FIRST : DIRECTION_NULLS_LAST);
}

// TODO: Handle additional order key types.
export function normalizeOrderKey(orderKey: OrderItemColumn): string {
  if (orderKey instanceof Utils.Col) {
    return orderKey.col;
  } else if (typeof orderKey === 'string') {
    return orderKey;
  }

  return orderKey.name;
}

export function getColumnReference<
  M extends Model<TModelAttributes, TCreationAttributes>,
  TModelAttributes extends Record<string, any> = any,
  TCreationAttributes extends Record<string, any> = TModelAttributes
>(model: ModelStatic<M>, aliasMap: AliasMap, orderKey: string) {
  const isTopLevelField = orderKey.split('.').length === 1;
  const aliasKey = isTopLevelField ? aliasMap[orderKey] : undefined;
  const isAlias = aliasKey !== undefined;
  const whereKey = aliasKey ?? orderKey;

  return typeof whereKey !== 'string' ? whereKey : Sequelize.col(isTopLevelField && !isAlias ? `${model.name}.${orderKey}` : orderKey);
};
