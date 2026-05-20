-- Add more MLAs for production-ready database

-- Additional Bengaluru MLAs
INSERT INTO mlas (name, party, constituency, city, state) VALUES
('N. A. Haris', 'INC', 'Shantinagar', 'bengaluru', 'Karnataka'),
('Priyank Kharge', 'INC', 'Chittapur', 'bengaluru', 'Karnataka'),
('Tanveer Sait', 'INC', 'Narasimharaja', 'bengaluru', 'Karnataka'),
('U. T. Khader', 'INC', 'Mangalore', 'bengaluru', 'Karnataka'),
('Rizwan Arshad', 'INC', 'Shivajinagar', 'bengaluru', 'Karnataka'),
('M. Krishnappa', 'INC', 'Vijayanagar', 'bengaluru', 'Karnataka'),
('Pradeep Eshwar', 'INC', 'Mahalakshmi Layout', 'bengaluru', 'Karnataka'),
('Ramalinga Reddy', 'INC', 'BTM Layout', 'bengaluru', 'Karnataka'),
('Munirathna', 'BJP', 'RR Nagar', 'bengaluru', 'Karnataka'),
('S. T. Somashekar', 'BJP', 'Yeshwanthpur', 'bengaluru', 'Karnataka')
ON CONFLICT (name, constituency) DO NOTHING;

-- Additional Mumbai MLAs
INSERT INTO mlas (name, party, constituency, city, state) VALUES
('Aslam Shaikh', 'INC', 'Malad West', 'mumbai', 'Maharashtra'),
('Naseem Khan', 'INC', 'Chandivali', 'mumbai', 'Maharashtra'),
('Yashomati Thakur', 'Shiv Sena (UBT)', 'Tejaswini', 'mumbai', 'Maharashtra'),
('Prakash Surve', 'Shiv Sena (UBT)', 'Magathane', 'mumbai', 'Maharashtra'),
('Ravindra Waikar', 'Shiv Sena', 'Jogeshwari East', 'mumbai', 'Maharashtra'),
('Sada Sarvankar', 'Shiv Sena', 'Mahim', 'mumbai', 'Maharashtra'),
('Murji Patel', 'BJP', 'Andheri East', 'mumbai', 'Maharashtra'),
('Yogesh Sagar', 'INC', 'Charkop', 'mumbai', 'Maharashtra'),
('Dilip Lande', 'Shiv Sena (UBT)', 'Chandivali', 'mumbai', 'Maharashtra'),
('Jyoti Gaikwad', 'INC', 'Dharavi', 'mumbai', 'Maharashtra')
ON CONFLICT (name, constituency) DO NOTHING;

-- Additional Delhi MLAs
INSERT INTO mlas (name, party, constituency, city, state) VALUES
('Manish Sisodia', 'AAP', 'Patparganj', 'delhi', 'Delhi'),
('Gopal Rai', 'AAP', 'Babarpur', 'delhi', 'Delhi'),
('Kailash Gahlot', 'AAP', 'Najafgarh', 'delhi', 'Delhi'),
('Imran Hussain', 'AAP', 'Ballimaran', 'delhi', 'Delhi'),
('Jarnail Singh', 'AAP', 'Tilak Nagar', 'delhi', 'Delhi'),
('Rituraj Govind', 'AAP', 'Kirari', 'delhi', 'Delhi'),
('Mohinder Goyal', 'BJP', 'Rithala', 'delhi', 'Delhi'),
('Jitendra Mahajan', 'BJP', 'Najafgarh', 'delhi', 'Delhi'),
('Om Prakash Sharma', 'BJP', 'Vishwas Nagar', 'delhi', 'Delhi'),
('Mohan Singh Bisht', 'BJP', 'Karawal Nagar', 'delhi', 'Delhi')
ON CONFLICT (name, constituency) DO NOTHING;

-- Additional Hyderabad MLAs
INSERT INTO mlas (name, party, constituency, city, state) VALUES
('Mahmood Ali', 'INC', 'Bahadurpura', 'hyderabad', 'Telangana'),
('Koppula Eshwar', 'BRS', 'Quthbullapur', 'hyderabad', 'Telangana'),
('Arekapudi Gandhi', 'BRS', 'Serilingampally', 'hyderabad', 'Telangana'),
('Jeevan Reddy', 'BRS', 'Jagtial', 'hyderabad', 'Telangana'),
('Gangula Kamalakar', 'BRS', 'Karimnagar', 'hyderabad', 'Telangana'),
('Malla Reddy', 'BRS', 'Medchal', 'hyderabad', 'Telangana'),
('Maganti Gopinath', 'INC', 'Jubilee Hills', 'hyderabad', 'Telangana'),
('Feroz Khan', 'AIMIM', 'Nampally', 'hyderabad', 'Telangana'),
('Jaffar Hussain Meraj', 'AIMIM', 'Bahadurpura', 'hyderabad', 'Telangana'),
('Kausar Mohiuddin', 'AIMIM', 'Karwan', 'hyderabad', 'Telangana')
ON CONFLICT (name, constituency) DO NOTHING;

-- Additional Chennai MLAs
INSERT INTO mlas (name, party, constituency, city, state) VALUES
('Kanimozhi Karunanidhi', 'DMK', 'Thoothukudi', 'chennai', 'Tamil Nadu'),
('T. R. B. Rajaa', 'DMK', 'Mannargudi', 'chennai', 'Tamil Nadu'),
('Senthil Balaji', 'DMK', 'Karur', 'chennai', 'Tamil Nadu'),
('E. V. Velu', 'DMK', 'Tiruttani', 'chennai', 'Tamil Nadu'),
('Govi Chezhiaan', 'DMK', 'Tiruvannamalai', 'chennai', 'Tamil Nadu'),
('Thangam Thennarasu', 'DMK', 'Madurai Central', 'chennai', 'Tamil Nadu'),
('Anbil Mahesh Poyyamozhi', 'DMK', 'Tiruchirapalli West', 'chennai', 'Tamil Nadu'),
('S. Regupathy', 'DMK', 'Tiruppur South', 'chennai', 'Tamil Nadu'),
('Edappadi K. Palaniswami', 'AIADMK', 'Edappadi', 'chennai', 'Tamil Nadu'),
('O. Panneerselvam', 'AIADMK', 'Bodinayakkanur', 'chennai', 'Tamil Nadu')
ON CONFLICT (name, constituency) DO NOTHING;

-- Additional Kolkata MLAs
INSERT INTO mlas (name, party, constituency, city, state) VALUES
('Partha Chatterjee', 'TMC', 'Behala Paschim', 'kolkata', 'West Bengal'),
('Chandrima Bhattacharya', 'TMC', 'Dum Dum', 'kolkata', 'West Bengal'),
('Subrata Mukherjee', 'TMC', 'Ballygunge', 'kolkata', 'West Bengal'),
('Sadhan Pande', 'TMC', 'Maniktala', 'kolkata', 'West Bengal'),
('Nayna Bandyopadhyay', 'TMC', 'Chunchura', 'kolkata', 'West Bengal'),
('Tapan Dasgupta', 'TMC', 'Saptagram', 'kolkata', 'West Bengal'),
('Samik Bhattacharya', 'BJP', 'Canning Paschim', 'kolkata', 'West Bengal'),
('Agnimitra Paul', 'BJP', 'Asansol Dakshin', 'kolkata', 'West Bengal'),
('Shankar Ghosh', 'BJP', 'Siliguri', 'kolkata', 'West Bengal'),
('Manoj Tigga', 'BJP', 'Madarihat', 'kolkata', 'West Bengal')
ON CONFLICT (name, constituency) DO NOTHING;
