-- Update news articles with varied timestamps over last 24 hours

UPDATE local_news SET published_at = NOW() - INTERVAL '2 hours' WHERE headline LIKE '%Bengaluru Metro Phase 3%';
UPDATE local_news SET published_at = NOW() - INTERVAL '4 hours' WHERE headline LIKE '%Silk Board%';
UPDATE local_news SET published_at = NOW() - INTERVAL '5 hours' WHERE headline LIKE '%Mumbai Metro Line 3%';
UPDATE local_news SET published_at = NOW() - INTERVAL '6 hours' WHERE headline LIKE '%Hyderabad ORR%';
UPDATE local_news SET published_at = NOW() - INTERVAL '7 hours' WHERE headline LIKE '%Chennai Port%';
UPDATE local_news SET published_at = NOW() - INTERVAL '8 hours' WHERE headline LIKE '%Delhi Metro%' AND headline LIKE '%Pink Line%';
UPDATE local_news SET published_at = NOW() - INTERVAL '9 hours' WHERE headline LIKE '%Hyderabad Metro%' AND headline LIKE '%Airport%';
UPDATE local_news SET published_at = NOW() - INTERVAL '10 hours' WHERE headline LIKE '%Mumbai Coastal Road%';
UPDATE local_news SET published_at = NOW() - INTERVAL '11 hours' WHERE headline LIKE '%dangerous buildings%';
UPDATE local_news SET published_at = NOW() - INTERVAL '12 hours' WHERE headline LIKE '%Chennai Metro%' AND headline LIKE '%Phase 2%';
UPDATE local_news SET published_at = NOW() - INTERVAL '13 hours' WHERE headline LIKE '%Airport Terminal 2%';
UPDATE local_news SET published_at = NOW() - INTERVAL '14 hours' WHERE headline LIKE '%Kolkata Metro%' AND headline LIKE '%Purple Line%';
UPDATE local_news SET published_at = NOW() - INTERVAL '15 hours' WHERE headline LIKE '%Air quality%';
UPDATE local_news SET published_at = NOW() - INTERVAL '16 hours' WHERE headline LIKE '%stormwater drain%';
UPDATE local_news SET published_at = NOW() - INTERVAL '17 hours' WHERE headline LIKE '%GHMC demolishes%';
UPDATE local_news SET published_at = NOW() - INTERVAL '18 hours' WHERE headline LIKE '%Coastal Road%' AND headline LIKE '%Worli%';
UPDATE local_news SET published_at = NOW() - INTERVAL '19 hours' WHERE headline LIKE '%Cauvery%';
UPDATE local_news SET published_at = NOW() - INTERVAL '20 hours' WHERE headline LIKE '%KMC identifies%';
UPDATE local_news SET published_at = NOW() - INTERVAL '21 hours' WHERE headline LIKE '%PWD completes%';
UPDATE local_news SET published_at = NOW() - INTERVAL '22 hours' WHERE headline LIKE '%Cooum river%';
UPDATE local_news SET published_at = NOW() - INTERVAL '23 hours' WHERE headline LIKE '%Bellandur Lake%';
UPDATE local_news SET published_at = NOW() - INTERVAL '1 day' WHERE headline LIKE '%Electronic City flyover%';
