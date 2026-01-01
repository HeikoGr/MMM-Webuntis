# WebUntis REST API Implementation Guide

Quick reference for implementing the new REST APIs in your code.

---

## Setup: Session Management

All REST API calls require proper session management. Use `axios` + `tough-cookie`:

```javascript

const { CookieJar } = require('tough-cookie');
const { wrapper } = require('CookieJar (custom implementation)-support');

// Create session-aware HTTP client
const createClient = (server) => {
  const cookieJar = new CookieJar();
  return wrapper(
    fetchClient with options {
      baseURL: `https://${server}/WebUntis`,
      jar: cookieJar,
      withCredentials: true,
      validateStatus: () => true, // Don't throw on any status
    })
  );
};

// Authenticate once - all subsequent calls include session cookies
const authenticateAndGetClient = async (server, school, username, password) => {
  const client = createClient(server);

  const response = await client.post(`/jsonrpc.do?school=${encodeURIComponent(school)}`, {
    id: `req-${Date.now()}`,
    method: 'authenticate',
    params: { user: username, password: password, client: 'App' },
    jsonrpc: '2.0',
  });

  if (response.status !== 200 || response.data?.error) {
    throw new Error(`Authentication failed: ${response.data?.error?.message}`);
  }

  return client;
};
```

---

## Bearer Token (JWT) via `/api/token/new`

Many REST "view" endpoints require a bearer token in addition to an authenticated session (cookies).

Canonical references:

- [../02-api-reference/BEARER_TOKEN_GUIDE.md](../02-api-reference/BEARER_TOKEN_GUIDE.md)
- [../01-getting-started/IMPLEMENTATION_REFERENCE.md](../01-getting-started/IMPLEMENTATION_REFERENCE.md)

```javascript
// Get bearer token (JWT). Keep using the same client instance so cookies are preserved.
const getBearerToken = async (client) => {
  const response = await client.get('/api/token/new');

  if (response.status === 200 && typeof response.data === 'string') {
    return response.data; // JWT token string
  }

  return null;
};

// Usage:
const token = await getBearerToken(client);
if (!token) throw new Error('Failed to obtain bearer token');

// Use BOTH: bearer token + the same cookie jar/session.
client.defaults.headers.common.Authorization = `Bearer ${token}`;
```

Note: A bearer token alone is typically not sufficient; keep the session cookies (CookieJar) as well.

---

## API Implementations

### 1. Absences API

```javascript
const fetchAbsences = async (client, studentId, startDate, endDate, excuseStatusId = -1) => {
  const response = await client.get(
    `/api/classreg/absences/students?studentId=${studentId}&startDate=${startDate}&endDate=${endDate}&excuseStatusId=${excuseStatusId}`
  );

  if (response.status !== 200) {
    throw new Error(`Failed to fetch absences: ${response.status}`);
  }

  const { absences = [], absenceReasons = [] } = response.data?.data || {};

  return {
    absences: absences.map((absence) => ({
      id: absence.id,
      studentName: absence.studentName,
      date: absence.startDate,
      startTime: absence.startTime,
      endTime: absence.endTime,
      isExcused: absence.isExcused,
      excuseStatus: absence.excuse?.excuseStatus,
      reason: absenceReasons.find((r) => r.id === absence.reasonId)?.name || absence.reason || 'N/A',
      text: absence.text,
      createdBy: absence.createdUser,
      lastUpdated: absence.lastUpdate,
    })),
    reasons: absenceReasons,
  };
};

// Example usage:
const { absences, reasons } = await fetchAbsences(client, {studentId}, '{startDate}', '{endDate}');
absences.forEach((absence) => {
  console.log(`${absence.date}: ${absence.studentName} (${absence.reason})`);
});
```

**Filter by excuse status:**
```javascript
// All absences
await fetchAbsences(client, studentId, startDate, endDate, -1);

// Excused only
await fetchAbsences(client, studentId, startDate, endDate, 1);

// Not excused only
await fetchAbsences(client, studentId, startDate, endDate, 2);
```

---

### 2. Homework API

```javascript
const fetchHomework = async (client, startDate = null, endDate = null, studentId = null) => {
  const params = new URLSearchParams();
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  if (studentId) params.append('studentId', studentId);

  const response = await client.get(`/api/homeworks/lessons?${params.toString()}`);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch homework: ${response.status}`);
  }

  const { records = [], homeworks = [], lessons = [], teachers = [] } = response.data?.data || {};

  return {
    records,  // Raw homework records
    homeworks, // Homework entries
    lessons,  // Associated lessons
    teachers, // Teacher information
  };
};

// Example usage:
const hw = await fetchHomework(client, '20251201', '20251231', {STUDENT_ID});
console.log(`Found ${hw.records.length} homework assignments`);
hw.records.forEach((record) => {
  console.log(`${record.setDate}: ${record.text}`);
});
```

---

### 3. Exams API

```javascript
const fetchExams = async (
  client,
  studentId,
  startDate = null,
  endDate = null,
  withGrades = false
) => {
  const params = new URLSearchParams({ studentId });
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  if (withGrades) params.append('withGrades', 'true');

  const response = await client.get(`/api/exams?${params.toString()}`);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch exams: ${response.status}`);
  }

  const { exams = [] } = response.data?.data || {};

  return exams.map((exam) => ({
    id: exam.id,
    subject: exam.subject,
    date: exam.examDate,
    startTime: exam.startTime,
    endTime: exam.endTime,
    examType: exam.examType,
    room: exam.rooms?.[0]?.name,
    teachers: exam.teachers?.map((t) => t.name) || [],
    grade: exam.grade,
    notes: exam.text,
  }));
};

// Example usage:
const exams = await fetchExams(client, {STUDENT_ID}, '20251201', '20251231', true);
exams.forEach((exam) => {
  console.log(`${exam.date}: ${exam.subject} (Grade: ${exam.grade || 'N/A'})`);
});
```

---

### 4. Class Services API

```javascript
const fetchClassServices = async (client, startDate, endDate) => {
  const response = await client.get(
    `/api/classreg/classservices?startDate=${startDate}&endDate=${endDate}`
  );

  if (response.status !== 200) {
    throw new Error(`Failed to fetch class services: ${response.status}`);
  }

  const { classRoles = [] } = response.data?.data || {};

  return classRoles.map((role) => ({
    id: role.id,
    person: `${role.foreName} ${role.longName}`,
    class: role.klasse?.name,
    duty: role.duty?.label,
    startDate: role.startDate,
    endDate: role.endDate,
  }));
};

// Example usage:
const services = await fetchClassServices(client, '20251215', '20251221');
services.forEach((s) => {
  console.log(`${s.person}: ${s.duty} in ${s.class}`);
});
```

---

### 5. Absences Metadata

```javascript
const fetchAbsencesMetadata = async (client) => {
  const response = await client.get('/api/classreg/absences/meta');

  if (response.status !== 200) {
    throw new Error(`Failed to fetch absences metadata: ${response.status}`);
  }

  return response.data?.data || {};
};

// Example usage:
const metadata = await fetchAbsencesMetadata(client);
console.log('Excuse Status Options:');
metadata.excuseStatuses?.forEach((status) => {
  console.log(`  ${status.id}: ${status.label}`);
});
```

---

## Complete Example: Multi-Student Monitoring

```javascript

const { CookieJar } = require('tough-cookie');
const { wrapper } = require('CookieJar (custom implementation)-support');

class WebUntisAPI {
  constructor(server, school, username, password) {
    this.server = server;
    this.school = school;
    this.username = username;
    this.password = password;
    this.client = null;
  }

  async authenticate() {
    const cookieJar = new CookieJar();
    this.client = wrapper(
      fetchClient with options {
        baseURL: `https://${this.server}/WebUntis`,
        jar: cookieJar,
        withCredentials: true,
        validateStatus: () => true,
      })
    );

    const response = await this.client.post(
      `/jsonrpc.do?school=${encodeURIComponent(this.school)}`,
      {
        id: `req-${Date.now()}`,
        method: 'authenticate',
        params: { user: this.username, password: this.password, client: 'App' },
        jsonrpc: '2.0',
      }
    );

    if (response.status !== 200) {
      throw new Error(`Authentication failed: ${response.data?.error?.message}`);
    }
  }

  async getStudentAbsences(studentId, startDate, endDate) {
    const response = await this.client.get(
      `/api/classreg/absences/students?studentId=${studentId}&startDate=${startDate}&endDate=${endDate}&excuseStatusId=-1`
    );
    return response.data?.data?.absences || [];
  }

  async getStudentHomework(studentId, startDate, endDate) {
    const response = await this.client.get(
      `/api/homeworks/lessons?studentId=${studentId}&startDate=${startDate}&endDate=${endDate}`
    );
    return response.data?.data?.records || [];
  }

  async getStudentExams(studentId, startDate, endDate) {
    const response = await this.client.get(
      `/api/exams?studentId=${studentId}&startDate=${startDate}&endDate=${endDate}`
    );
    return response.data?.data?.exams || [];
  }
}

// Usage:
const api = new WebUntisAPI('{server}', '{school}', '{username}', '{password}');
await api.authenticate();

// Monitor multiple children
const studentIds = [{studentId1}, {studentId2}];
for (const studentId of studentIds) {
  const absences = await api.getStudentAbsences(studentId, '{startDate}', '{endDate}');
  const homework = await api.getStudentHomework(studentId, '{startDate}', '{endDate}');
  const exams = await api.getStudentExams(studentId, '{startDate}', '{endDate}');

  console.log(`Student ${studentId}:`);
  console.log(`  Absences: ${absences.length}`);
  console.log(`  Homework: ${homework.length}`);
  console.log(`  Exams: ${exams.length}`);
}
```

---

## Date Format Reference

All APIs use `YYYYMMDD` format:

```javascript
// Convert Date to WebUntis format
function toWebUntisDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

const today = new Date();
const startDate = toWebUntisDate(new Date(today.getFullYear(), today.getMonth(), 1));
const endDate = toWebUntisDate(new Date(today.getFullYear(), 11, 31));

console.log(`${startDate} to ${endDate}`); // "{startDate}" to "{endDate}"
```

---

## Error Handling

```javascript
const handleAPIError = (error, context) => {
  if (error.response) {
    switch (error.response.status) {
      case 401:
        console.error(`${context}: Unauthorized - check credentials`);
        break;
      case 403:
        console.error(`${context}: Forbidden - insufficient permissions`);
        break;
      case 404:
        console.error(`${context}: Endpoint not found`);
        break;
      case 500:
        console.error(`${context}: Server error`);
        break;
      default:
        console.error(`${context}: HTTP ${error.response.status}`);
    }
  } else {
    console.error(`${context}: ${error.message}`);
  }
};

// Usage:
try {
  const absences = await fetchAbsences(client, {STUDENT_ID}, '20250901', '20251231');
} catch (error) {
  handleAPIError(error, 'Fetch absences');
}
```

---

## Performance Tips

1. **Reuse client connection** - Create once, use for all requests
2. **Batch requests** - Fetch all students' data in parallel loops when possible
3. **Cache metadata** - `/api/classreg/absences/meta` changes rarely
4. **Use date ranges** - Narrow date ranges reduce response size
5. **Implement retry logic** - Network issues are possible

---

## Dependencies

Make sure your project has these installed:

```bash
npm install axios tough-cookie CookieJar (custom implementation)-support
```

Add to `package.json`:

```json
{
  "dependencies": {
    
    "tough-cookie": "^4.1.0",
    "CookieJar (custom implementation)-support": "^4.0.4"
  }
}
```

---

## Testing Your Implementation

Use the discovery tools to verify everything works:

```bash
# Test absences API
node cli/test-absences-rest-api.js config/config.js {studentId} {startDate} {endDate}

# Deep parameter testing
node cli/api-detailed-analysis.js config/config.js {studentId}

# Full API analysis
node cli/api-browser-discovery.js config/config.js {studentId}
```

---

## Next Steps

1. Integrate these functions into `node_helper.js`
2. Add REST API calls alongside (or replacing) JSON-RPC methods
3. Test with multiple students and date ranges
4. Consider caching for frequently accessed data
5. Update widget renderers to use new data structure
