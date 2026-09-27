export async function up(db) {
  await db.schema
    .createTable("items")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("marker", "text", (column) => column.notNull())
    .addColumn("source", "text", (column) => column.notNull())
    .execute();
}
export async function down(db) {
  await db.schema.dropTable("items").execute();
}
