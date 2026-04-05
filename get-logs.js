const https = require('https');

async function getLogs() {
    try {
        const response = await fetch('https://api.github.com/repos/yaelbaram8-crypto/test1/actions/runs', {
            headers: { 'User-Agent': 'node.js' }
        });
        const data = await response.json();
        const runs = data.workflow_runs;
        if (!runs || runs.length === 0) { console.log('No runs found'); return; }
        const latestRun = runs[0];
        console.log('Downloading logs for run:', latestRun.id);
        
        const jobsResponse = await fetch(latestRun.jobs_url, { headers: { 'User-Agent': 'node.js' } });
        const jobsData = await jobsResponse.json();
        const job = jobsData.jobs[0];
        if (!job) { console.log('No jobs found in run'); return; }
        
        console.log('Job:', job.name, 'Status:', job.status, 'Conclusion:', job.conclusion);
        
        // Unfortunately, downloading logs zip via API without auth token might fail if repo is private, 
        // but repo is public. However, logs endpoint might redirect.
        console.log('To see what failed, we rely on the step conclusions.');
        job.steps.forEach(s => {
            if (s.conclusion === 'failure') console.log('FAILED STEP:', s.name);
        });
        
    } catch(e) {
        console.error('Error fetching logs:', e);
    }
}
getLogs();
