-- No room may hold two active (non-cancelled) bookings on the same night.
--
-- The booking routes already check for a clash before saving, but that check and the
-- save are separate requests: a double-click, or the web and mobile apps saving at the
-- same moment, could both pass the check. Edits that changed only the dates, or
-- re-activated a cancelled booking, skipped the check altogether. This is the backstop
-- every path goes through - web, mobile, iCal sync and one-off scripts.
--
-- A per-room advisory lock serialises concurrent saves for the same room, so the second
-- one waits for the first to commit and then sees it. Raised as exclusion_violation
-- (23P01), which lib/booking-clash.ts turns into a 409 for the user.
--
-- Hand-written (triggers aren't in the Drizzle schema), so it isn't in meta/_journal.json;
-- apply it to the database directly, as with the other recent migrations.

CREATE OR REPLACE FUNCTION assert_no_booking_room_clash(p_booking_id integer, p_room_id integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  b       bookings%ROWTYPE;
  clash   bookings%ROWTYPE;
  room    text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('booking_room'), p_room_id);

  SELECT * INTO b FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND OR b.status = 'cancelled' THEN RETURN; END IF;

  SELECT o.* INTO clash
    FROM booking_rooms x
    JOIN bookings o ON o.id = x.booking_id
   WHERE x.room_id = p_room_id
     AND o.id <> p_booking_id
     AND o.status <> 'cancelled'
     AND o.check_in  < b.check_out
     AND o.check_out > b.check_in
   LIMIT 1;

  IF FOUND THEN
    SELECT name INTO room FROM rooms WHERE id = p_room_id;
    RAISE EXCEPTION '% is already booked by % (#%) from % to %',
      room, clash.guest_name, clash.id, clash.check_in, clash.check_out
      USING ERRCODE = 'exclusion_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION booking_rooms_clash_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_no_booking_room_clash(NEW.booking_id, NEW.room_id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION bookings_clash_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r integer;
BEGIN
  FOR r IN SELECT room_id FROM booking_rooms WHERE booking_id = NEW.id ORDER BY room_id LOOP
    PERFORM assert_no_booking_room_clash(NEW.id, r);
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS booking_rooms_no_clash ON booking_rooms;
CREATE TRIGGER booking_rooms_no_clash
  AFTER INSERT OR UPDATE ON booking_rooms
  FOR EACH ROW EXECUTE FUNCTION booking_rooms_clash_check();

DROP TRIGGER IF EXISTS bookings_no_clash ON bookings;
CREATE TRIGGER bookings_no_clash
  AFTER UPDATE OF check_in, check_out, status ON bookings
  FOR EACH ROW WHEN (NEW.status <> 'cancelled')
  EXECUTE FUNCTION bookings_clash_check();
