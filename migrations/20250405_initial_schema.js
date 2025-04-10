/**
 * Initial database schema migration
 */
exports.up = function (knex) {
  return knex.schema
    // Create animations table
    .createTable('animations', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.text('voiceover_text').notNullable();
      table.string('original_video_key').notNullable();
      table.string('status').defaultTo('pending');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    })
    // Create processed_videos table
    .createTable('processed_videos', (table) => {
      table.increments('id').primary();
      table.integer('animation_id').unsigned().references('id').inTable('animations').onDelete('CASCADE');
      table.string('language', 10).notNullable();
      table.string('video_key').notNullable();
      table.string('status').defaultTo('pending');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      
      // Composite unique constraint
      table.unique(['animation_id', 'language']);
    });
};

/**
 * Rollback migration
 */
exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('processed_videos')
    .dropTableIfExists('animations');
};