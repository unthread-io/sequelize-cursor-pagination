import { FindOptions, Model, ModelStatic, Utils } from 'sequelize';

export type OrderItemColumn = string | Utils.Col | ModelStatic<Model>;
export type OrderItem = [...OrderItemColumn[], string];

export interface BasePaginateOptions<TAttributes = any> extends Omit<FindOptions<TAttributes>, 'order'> {
  cursor?: [boolean, unknown[]];
  order?: OrderItemColumn | OrderItem | (OrderItemColumn | OrderItem)[];
};

export interface PaginateWithoutTotalCountOptions<TAttributes = any> extends BasePaginateOptions<TAttributes>  {
  cursor?: [boolean, unknown[]];
  order?: OrderItemColumn | OrderItem | (OrderItemColumn | OrderItem)[];
  includeTotalCount?: false;
};

export interface PaginateWithTotalCountOptions<TAttributes = any> extends BasePaginateOptions<TAttributes> {
  includeTotalCount: true;
};

export type PaginateOptions<TAttributes = any> = PaginateWithoutTotalCountOptions<TAttributes> | PaginateWithTotalCountOptions<TAttributes>;

export type PaginationCursor = [boolean, unknown[]];

export interface Cursors {
  next?: PaginationCursor;
  previous?: PaginationCursor;
  hasNext: boolean;
  hasPrevious: boolean;
}

export type AliasMap = Record<string, (string | Utils.Literal | Utils.Fn | Utils.Col)>;
