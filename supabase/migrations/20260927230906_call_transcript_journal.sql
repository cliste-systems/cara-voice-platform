-- Private source-event journal, separate from the redacted staff transcript.
create table public.call_transcript_captures (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 call_log_id uuid references public.call_logs(id) on delete cascade,
 room_name text not null,
 started_at timestamptz not null,
 updated_at timestamptz not null default now(),
 status text not null default 'recording' check (status in ('recording','captured','partial')),
 expected_events integer,
 persisted_events integer not null default 0,
 completeness jsonb,
 last_error text
);
create table public.call_transcript_events (
 capture_id uuid not null references public.call_transcript_captures(id) on delete cascade,
 seq integer not null check(seq>0),
 received_at timestamptz not null,
 source text not null,
 speaker text not null check(speaker in ('caller','assistant','system')),
 text text not null,
 metadata jsonb not null default '{}'::jsonb,
 primary key(capture_id,seq)
);
alter table public.call_transcript_captures enable row level security;
alter table public.call_transcript_events enable row level security;
revoke all on public.call_transcript_captures,public.call_transcript_events from anon,authenticated;
grant select,insert,update,delete on public.call_transcript_captures,public.call_transcript_events to service_role;
create policy transcript_capture_service on public.call_transcript_captures for all to service_role using(true) with check(true);
create policy transcript_events_service on public.call_transcript_events for all to service_role using(true) with check(true);
create index call_transcript_captures_room on public.call_transcript_captures(room_name,started_at desc);
create index call_transcript_captures_retention on public.call_transcript_captures(started_at);
-- A crashed worker must stay visibly partial, never become a complete record.
select cron.schedule('call-transcript-journal-health','* * * * *', $$
 update public.call_transcript_captures set status='partial',last_error='Capture heartbeat stopped before final verification'
 where status='recording' and updated_at<now()-interval '5 minutes';
$$);
-- Same 30-day transcript ceiling as existing transcript retention.
select cron.schedule('call-transcript-journal-retention','17 3 * * *', $$
 delete from public.call_transcript_captures where started_at<now()-interval '30 days';
$$);
