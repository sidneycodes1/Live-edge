-- 017_trades_sell.sql — allow 'sell' kind on trades table for position cash-out
alter table trades drop constraint if exists trades_kind_check;
alter table trades add constraint trades_kind_check check (kind in ('buy','sell','claim','creator_fee_claim'));
