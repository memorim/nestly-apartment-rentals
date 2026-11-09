CREATE FUNCTION enqueue_inquiry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO inquiry_events(inquiry_id,created_at) VALUES(NEW.id,NEW.created_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER inquiries_enqueue AFTER INSERT ON inquiries FOR EACH ROW EXECUTE FUNCTION enqueue_inquiry();
