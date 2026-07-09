-- ============================================================
--  PATCH 10: Add OpenRouter API key support (server-side)
--
--  Run this in the Supabase SQL Editor. It only adds one column
--  and replaces three functions — no data is dropped or moved.
--
--  ASSUMES: your _encrypt_key(text) / _decrypt_key(bytea) functions
--  are already working (i.e. patch9b or equivalent has been applied
--  and the round-trip test in that patch succeeded). This patch does
--  not touch _encrypt_key/_decrypt_key — it just calls them, so it
--  works no matter which passphrase source (Vault vs app_config)
--  your project currently has live.
--
--  WHAT THIS ADDS:
--    1. user_settings.openrouter_key_enc — new encrypted-key column.
--    2. store_user_key() / get_user_key() — now accept 'openrouter'
--       as a valid p_key_type, alongside anthropic/mistral/rss2json.
--    3. get_user_key_flags() — now also returns "openrouter_set",
--       which is what auth.js's loadSettings() reads to set
--       remote.openrouterKeySet on the client.
--
--  DELIBERATELY NOT INCLUDED:
--    A default_openrouter_key auto-fill, the way mistral/rss2json
--    have a developer-supplied fallback key in app_config. OpenRouter
--    keys are tied to a personal account/usage, so auto-provisioning
--    every user with your own key isn't something you want silently
--    enabled. get_user_key('openrouter') WILL still check app_config
--    for a 'default_openrouter_key' row for consistency with the
--    other key types' code path, but unless you explicitly insert
--    that row yourself, it simply stays unset — the key is 100%
--    opt-in per user, entered manually in Settings, exactly how the
--    client-side code already expects it to work.
-- ============================================================


-- ============================================================
--  1. Add the encrypted-key column (idempotent — safe to re-run)
-- ============================================================
alter table public.user_settings
  add column if not exists openrouter_key_enc bytea;  -- NULL = not set by user (no auto-default)


-- ============================================================
--  2. REPLACE store_user_key — add 'openrouter' as a valid type
-- ============================================================
create or replace function public.store_user_key(
  p_key_type  text,
  p_key_value text
) returns void language plpgsql security definer as $$
declare
  v_enc bytea;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_key_type not in ('anthropic', 'mistral', 'rss2json', 'openrouter') then
    raise exception 'Invalid key type: %', p_key_type;
  end if;
  if p_key_value is null or length(trim(p_key_value)) = 0 then
    raise exception 'Key value must not be empty';
  end if;

  v_enc := public._encrypt_key(p_key_value);

  if p_key_type = 'anthropic' then
    update public.user_settings
       set anthropic_key_enc = v_enc, updated_at = now()
     where user_id = auth.uid();
  elsif p_key_type = 'mistral' then
    update public.user_settings
       set mistral_key_enc = v_enc, updated_at = now()
     where user_id = auth.uid();
  elsif p_key_type = 'rss2json' then
    update public.user_settings
       set rss2json_key_enc = v_enc, updated_at = now()
     where user_id = auth.uid();
  elsif p_key_type = 'openrouter' then
    update public.user_settings
       set openrouter_key_enc = v_enc, updated_at = now()
     where user_id = auth.uid();
  end if;
end;
$$;


-- ============================================================
--  3. REPLACE get_user_key — add 'openrouter' as a valid type
--     Same fallback shape as the other types (checks app_config
--     for a default first), but see the note at the top of this
--     file — no default_openrouter_key row is inserted here, so
--     in practice this always resolves to "the user's own key or
--     empty string" unless you deliberately add one later.
-- ============================================================
create or replace function public.get_user_key(p_key_type text)
returns text language plpgsql security definer as $$
declare
  v_enc        bytea;
  v_default    text;
  v_config_key text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_key_type not in ('anthropic', 'mistral', 'rss2json', 'openrouter') then
    raise exception 'Invalid key type: %', p_key_type;
  end if;

  -- 1. Read the user's own encrypted key
  if p_key_type = 'anthropic' then
    select anthropic_key_enc into v_enc
      from public.user_settings where user_id = auth.uid();
    v_config_key := 'default_anthropic_key';
  elsif p_key_type = 'mistral' then
    select mistral_key_enc into v_enc
      from public.user_settings where user_id = auth.uid();
    v_config_key := 'default_mistral_key';
  elsif p_key_type = 'rss2json' then
    select rss2json_key_enc into v_enc
      from public.user_settings where user_id = auth.uid();
    v_config_key := 'default_rss2json_key';
  elsif p_key_type = 'openrouter' then
    select openrouter_key_enc into v_enc
      from public.user_settings where user_id = auth.uid();
    v_config_key := 'default_openrouter_key';
  end if;

  -- 2. If the user already has their own key, decrypt and return it
  if v_enc is not null then
    return public._decrypt_key(v_enc);
  end if;

  -- 3. No user key — look up an app-wide default in app_config, if any
  select value into v_default
    from public.app_config
   where key = v_config_key
   limit 1;

  if v_default is null or length(trim(v_default)) = 0 then
    -- No user key and no default configured — return empty; caller handles this
    return '';
  end if;

  -- 4. Encrypt the default and persist it as the user's own key
  declare
    v_enc_default bytea;
  begin
    v_enc_default := public._encrypt_key(v_default);

    if p_key_type = 'anthropic' then
      update public.user_settings
         set anthropic_key_enc = v_enc_default, updated_at = now()
       where user_id = auth.uid();
    elsif p_key_type = 'mistral' then
      update public.user_settings
         set mistral_key_enc = v_enc_default, updated_at = now()
       where user_id = auth.uid();
    elsif p_key_type = 'rss2json' then
      update public.user_settings
         set rss2json_key_enc = v_enc_default, updated_at = now()
       where user_id = auth.uid();
    elsif p_key_type = 'openrouter' then
      update public.user_settings
         set openrouter_key_enc = v_enc_default, updated_at = now()
       where user_id = auth.uid();
    end if;
  exception when others then
    null; -- still return the plaintext even if the write-back fails
  end;

  return v_default;
end;
$$;

grant execute on function public.store_user_key(text, text) to authenticated;
grant execute on function public.get_user_key(text)         to authenticated;


-- ============================================================
--  4. REPLACE get_user_key_flags — add "openrouter_set"
--     This is what dashboard.html's remote.openrouterKeySet reads.
--     (The client currently works around this flag being absent by
--     always attempting to fetch the key regardless — but adding
--     this makes the "Key saved ✓" indicator in Settings accurate
--     again, and removes the need for that workaround.)
-- ============================================================
create or replace function public.get_user_key_flags()
returns json language plpgsql security definer as $$
declare
  v_row public.user_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row
    from public.user_settings
   where user_id = auth.uid();

  return json_build_object(
    'anthropic_set',  (v_row.anthropic_key_enc  is not null),
    'mistral_set',    (v_row.mistral_key_enc    is not null),
    'rss2json_set',   (v_row.rss2json_key_enc   is not null),
    'openrouter_set', (v_row.openrouter_key_enc is not null)
  );
end;
$$;

grant execute on function public.get_user_key_flags() to authenticated;


-- ============================================================
--  5. Verify (run while logged in as a user who has saved an
--     OpenRouter key from the dashboard Settings tab)
--     Expect: "openrouter_set":true along with whatever else is set
-- ============================================================
select public.get_user_key_flags();

-- Optional deeper check — confirms round-trip decrypt works, not
-- just that the column is non-null:
-- select length(public.get_user_key('openrouter')) as openrouter_key_length;
