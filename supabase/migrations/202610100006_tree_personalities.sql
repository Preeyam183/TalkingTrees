alter table tree_dialogue
  add column if not exists personality text not null default 'warm';
