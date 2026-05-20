-- Populate MLAs for 6 cities

-- Bengaluru MLAs (Karnataka)
INSERT INTO mlas (name, party, constituency, city, state, contact, email) VALUES
('Arvind Limbavali', 'BJP', 'Mahadevapura', 'bengaluru', 'Karnataka', NULL, NULL),
('Byrathi Suresh', 'BJP', 'Hebbal', 'bengaluru', 'Karnataka', NULL, NULL),
('Krishna Byre Gowda', 'INC', 'Byatarayanapura', 'bengaluru', 'Karnataka', NULL, NULL),
('Ramalinga Reddy', 'INC', 'BTM Layout', 'bengaluru', 'Karnataka', NULL, NULL),
('Zameer Ahmed Khan', 'INC', 'Chamarajpet', 'bengaluru', 'Karnataka', NULL, NULL),
('Satish Reddy', 'INC', 'Bommanahalli', 'bengaluru', 'Karnataka', NULL, NULL),
('Suresh Kumar', 'BJP', 'Rajajinagar', 'bengaluru', 'Karnataka', NULL, NULL),
('Sowmya Reddy', 'INC', 'Jayanagar', 'bengaluru', 'Karnataka', NULL, NULL),
('Ashwath Narayan', 'BJP', 'Malleshwaram', 'bengaluru', 'Karnataka', NULL, NULL),
('Dinesh Gundu Rao', 'INC', 'Gandhinagar', 'bengaluru', 'Karnataka', NULL, NULL)
ON CONFLICT (name, constituency) DO NOTHING;

-- Mumbai MLAs (Maharashtra)
INSERT INTO mlas (name, party, constituency, city, state, contact, email) VALUES
('Aaditya Thackeray', 'Shiv Sena (UBT)', 'Worli', 'mumbai', 'Maharashtra', NULL, NULL),
('Ashish Shelar', 'BJP', 'Bandra West', 'mumbai', 'Maharashtra', NULL, NULL),
('Varsha Gaikwad', 'INC', 'Dharavi', 'mumbai', 'Maharashtra', NULL, NULL),
('Mangal Prabhat Lodha', 'BJP', 'Malabar Hill', 'mumbai', 'Maharashtra', NULL, NULL),
('Zeeshan Siddique', 'INC', 'Bandra East', 'mumbai', 'Maharashtra', NULL, NULL),
('Kalidas Kolambkar', 'BJP', 'Wadala', 'mumbai', 'Maharashtra', NULL, NULL),
('Sunil Prabhu', 'Shiv Sena (UBT)', 'Dindoshi', 'mumbai', 'Maharashtra', NULL, NULL),
('Parag Shah', 'BJP', 'Ghatkopar East', 'mumbai', 'Maharashtra', NULL, NULL),
('Ajay Choudhari', 'Shiv Sena (UBT)', 'Shivadi', 'mumbai', 'Maharashtra', NULL, NULL),
('Ameet Satam', 'BJP', 'Andheri West', 'mumbai', 'Maharashtra', NULL, NULL)
ON CONFLICT (name, constituency) DO NOTHING;

-- Delhi MLAs
INSERT INTO mlas (name, party, constituency, city, state, contact, email) VALUES
('Atishi Marlena', 'AAP', 'Kalkaji', 'delhi', 'Delhi', NULL, NULL),
('Saurabh Bharadwaj', 'AAP', 'Greater Kailash', 'delhi', 'Delhi', NULL, NULL),
('Raghav Chadha', 'AAP', 'Rajinder Nagar', 'delhi', 'Delhi', NULL, NULL),
('Vijender Gupta', 'BJP', 'Rohini', 'delhi', 'Delhi', NULL, NULL),
('Ramvir Singh Bidhuri', 'BJP', 'Badarpur', 'delhi', 'Delhi', NULL, NULL),
('Durgesh Pathak', 'AAP', 'Rajendra Nagar', 'delhi', 'Delhi', NULL, NULL),
('Praveen Kumar', 'AAP', 'Jangpura', 'delhi', 'Delhi', NULL, NULL),
('Abhay Verma', 'BJP', 'Laxmi Nagar', 'delhi', 'Delhi', NULL, NULL),
('Somnath Bharti', 'AAP', 'Malviya Nagar', 'delhi', 'Delhi', NULL, NULL),
('Amanatullah Khan', 'AAP', 'Okhla', 'delhi', 'Delhi', NULL, NULL)
ON CONFLICT (name, constituency) DO NOTHING;

-- Hyderabad MLAs (Telangana)
INSERT INTO mlas (name, party, constituency, city, state, contact, email) VALUES
('K. T. Rama Rao', 'BRS', 'Sircilla', 'hyderabad', 'Telangana', NULL, NULL),
('T. Harish Rao', 'BRS', 'Siddipet', 'hyderabad', 'Telangana', NULL, NULL),
('Akbaruddin Owaisi', 'AIMIM', 'Chandrayangutta', 'hyderabad', 'Telangana', NULL, NULL),
('Raja Singh', 'BJP', 'Goshamahal', 'hyderabad', 'Telangana', NULL, NULL),
('Danam Nagender', 'INC', 'Khairatabad', 'hyderabad', 'Telangana', NULL, NULL),
('Komatireddy Venkat Reddy', 'INC', 'Nalgonda', 'hyderabad', 'Telangana', NULL, NULL),
('Sabita Indra Reddy', 'BRS', 'Maheshwaram', 'hyderabad', 'Telangana', NULL, NULL),
('Talasani Srinivas Yadav', 'BRS', 'Sanath Nagar', 'hyderabad', 'Telangana', NULL, NULL),
('Jeevan Reddy', 'INC', 'Jagtial', 'hyderabad', 'Telangana', NULL, NULL),
('Palla Rajeshwar Reddy', 'BRS', 'Munugode', 'hyderabad', 'Telangana', NULL, NULL)
ON CONFLICT (name, constituency) DO NOTHING;

-- Chennai MLAs (Tamil Nadu)
INSERT INTO mlas (name, party, constituency, city, state, contact, email) VALUES
('Udhayanidhi Stalin', 'DMK', 'Chepauk-Thiruvallikeni', 'chennai', 'Tamil Nadu', NULL, NULL),
('Dayanidhi Maran', 'DMK', 'Chennai Central', 'chennai', 'Tamil Nadu', NULL, NULL),
('J. Anbazhagan', 'DMK', 'Chepauk', 'chennai', 'Tamil Nadu', NULL, NULL),
('Sekar Babu', 'DMK', 'Harbour', 'chennai', 'Tamil Nadu', NULL, NULL),
('Kalanidhi Veeraswamy', 'DMK', 'Villivakkam', 'chennai', 'Tamil Nadu', NULL, NULL),
('Vanathi Srinivasan', 'BJP', 'Coimbatore South', 'chennai', 'Tamil Nadu', NULL, NULL),
('Ma Subramanian', 'DMK', 'Saidapet', 'chennai', 'Tamil Nadu', NULL, NULL),
('I. Periyasamy', 'DMK', 'Kolathur', 'chennai', 'Tamil Nadu', NULL, NULL),
('N. Ramachandran', 'AIADMK', 'Mylapore', 'chennai', 'Tamil Nadu', NULL, NULL),
('Gokul Indira', 'DMK', 'Egmore', 'chennai', 'Tamil Nadu', NULL, NULL)
ON CONFLICT (name, constituency) DO NOTHING;

-- Kolkata MLAs (West Bengal)
INSERT INTO mlas (name, party, constituency, city, state, contact, email) VALUES
('Firhad Hakim', 'TMC', 'Kolkata Port', 'kolkata', 'West Bengal', NULL, NULL),
('Aroop Biswas', 'TMC', 'Tollygunge', 'kolkata', 'West Bengal', NULL, NULL),
('Sujit Bose', 'TMC', 'Bidhannagar', 'kolkata', 'West Bengal', NULL, NULL),
('Madan Mitra', 'TMC', 'Kamarhati', 'kolkata', 'West Bengal', NULL, NULL),
('Sashi Panja', 'TMC', 'Shyampukur', 'kolkata', 'West Bengal', NULL, NULL),
('Suvendu Adhikari', 'BJP', 'Nandigram', 'kolkata', 'West Bengal', NULL, NULL),
('Debashree Chowdhury', 'BJP', 'Raigunj', 'kolkata', 'West Bengal', NULL, NULL),
('Sovandeb Chattopadhyay', 'TMC', 'Behala Purba', 'kolkata', 'West Bengal', NULL, NULL),
('Ratna Chatterjee', 'TMC', 'Baranagar', 'kolkata', 'West Bengal', NULL, NULL),
('Tapas Roy', 'TMC', 'Kolkata Port', 'kolkata', 'West Bengal', NULL, NULL)
ON CONFLICT (name, constituency) DO NOTHING;
