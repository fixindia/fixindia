// Indian Cities & States Configuration
export const INDIAN_CITIES = {
  // Tier 1 Cities
  bangalore: {
    name: 'Bengaluru',
    state: 'Karnataka',
    enabled: true,
    wards: 243,
    sources: {
      mla: 'https://en.wikipedia.org/wiki/List_of_constituencies_of_the_Karnataka_Legislative_Assembly',
      news: ['deccanherald.com', 'thehindu.com', 'timesofindia.indiatimes.com'],
      government: 'https://bbmp.gov.in',
    }
  },
  mumbai: {
    name: 'Mumbai',
    state: 'Maharashtra',
    enabled: true,
    wards: 227,
    sources: {
      mla: 'https://en.wikipedia.org/wiki/List_of_constituencies_of_the_Maharashtra_Legislative_Assembly',
      news: ['mumbaimirror.indiatimes.com', 'mid-day.com', 'hindustantimes.com'],
      government: 'https://portal.mcgm.gov.in',
    }
  },
  delhi: {
    name: 'Delhi',
    state: 'Delhi',
    enabled: true,
    wards: 272,
    sources: {
      mla: 'https://en.wikipedia.org/wiki/List_of_constituencies_of_the_Delhi_Legislative_Assembly',
      news: ['indianexpress.com', 'thehindu.com', 'hindustantimes.com'],
      government: 'https://www.delhi.gov.in',
    }
  },
  hyderabad: {
    name: 'Hyderabad',
    state: 'Telangana',
    enabled: true,
    wards: 150,
    sources: {
      mla: 'https://en.wikipedia.org/wiki/List_of_constituencies_of_the_Telangana_Legislative_Assembly',
      news: ['thehindu.com', 'deccanchronicle.com', 'timesofindia.indiatimes.com'],
      government: 'https://www.ghmc.gov.in',
    }
  },
  chennai: {
    name: 'Chennai',
    state: 'Tamil Nadu',
    enabled: true,
    wards: 200,
    sources: {
      mla: 'https://en.wikipedia.org/wiki/List_of_constituencies_of_the_Tamil_Nadu_Legislative_Assembly',
      news: ['thehindu.com', 'newindianexpress.com', 'timesofindia.indiatimes.com'],
      government: 'https://www.chennaicorporation.gov.in',
    }
  },
  kolkata: {
    name: 'Kolkata',
    state: 'West Bengal',
    enabled: true,
    wards: 144,
    sources: {
      mla: 'https://en.wikipedia.org/wiki/List_of_constituencies_of_the_West_Bengal_Legislative_Assembly',
      news: ['telegraphindia.com', 'thehindu.com', 'timesofindia.indiatimes.com'],
      government: 'https://www.kmcgov.in',
    }
  },
  pune: {
    name: 'Pune',
    state: 'Maharashtra',
    enabled: false, // Enable after testing
    wards: 41,
    sources: {
      mla: 'https://en.wikipedia.org/wiki/List_of_constituencies_of_the_Maharashtra_Legislative_Assembly',
      news: ['punemirror.in', 'timesofindia.indiatimes.com'],
      government: 'https://www.pmc.gov.in',
    }
  },
  ahmedabad: {
    name: 'Ahmedabad',
    state: 'Gujarat',
    enabled: false,
    wards: 192,
    sources: {
      mla: 'https://en.wikipedia.org/wiki/List_of_constituencies_of_the_Gujarat_Legislative_Assembly',
      news: ['timesofindia.indiatimes.com', 'indianexpress.com'],
      government: 'https://ahmedabadcity.gov.in',
    }
  },
};

// Government Data Sources (Whitelisted)
export const GOVERNMENT_SOURCES = [
  'gov.in',
  'nic.in',
  'india.gov.in',
  'mygov.in',
  'bbmp.gov.in',
  'mcgm.gov.in',
  'ghmc.gov.in',
  'chennaicorporation.gov.in',
  'kmcgov.in',
  'pmc.gov.in',
];

// Trusted News Sources (Whitelisted)
export const NEWS_SOURCES = {
  national: [
    { name: 'The Hindu', domain: 'thehindu.com', rss: true },
    { name: 'Times of India', domain: 'timesofindia.indiatimes.com', rss: true },
    { name: 'Indian Express', domain: 'indianexpress.com', rss: true },
    { name: 'Hindustan Times', domain: 'hindustantimes.com', rss: true },
    { name: 'NDTV', domain: 'ndtv.com', rss: true },
  ],
  regional: {
    karnataka: [
      { name: 'Deccan Herald', domain: 'deccanherald.com', rss: true },
      { name: 'Bangalore Mirror', domain: 'bangaloremirror.indiatimes.com', rss: false },
    ],
    maharashtra: [
      { name: 'Mumbai Mirror', domain: 'mumbaimirror.indiatimes.com', rss: false },
      { name: 'Mid-Day', domain: 'mid-day.com', rss: true },
    ],
    telangana: [
      { name: 'Deccan Chronicle', domain: 'deccanchronicle.com', rss: true },
    ],
    tamilnadu: [
      { name: 'New Indian Express', domain: 'newindianexpress.com', rss: true },
    ],
    westbengal: [
      { name: 'Telegraph India', domain: 'telegraphindia.com', rss: true },
    ],
  }
};

// Scraping Schedule (IST - Indian Standard Time)
export const SCRAPING_SCHEDULE = {
  news: {
    cron: '0 3,5,7 * * *', // 3 AM, 5 AM, 7 AM IST
    description: 'News scraping during off-peak hours'
  },
  mla: {
    cron: '0 4 * * 0', // 4 AM every Sunday
    description: 'MLA data update weekly'
  },
  government: {
    cron: '0 6 * * 1', // 6 AM every Monday
    description: 'Government project data'
  },
  verification: {
    cron: '*/30 * * * *', // Every 30 minutes
    description: 'Process pending verifications'
  }
};
