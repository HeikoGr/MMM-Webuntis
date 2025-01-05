# MMM-Webuntis

This an extension for the [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror). It allows to display your kids' cancelled and irregular lessons for schools using [Untis](https://www.untis.at) software to organize school's timetables. You are able to configure access for each of your kids.

## Installation

1. Navigate into your MagicMirror²'s `modules` folder and execute `git clone https://github.com/HeikoGr/MMM-Webuntis`.
2. Navigate into the new folder `MMM-Webuntis` and execute `npm install` to generate the node dependencies.

## Update

1. Navigate into your MMM-Webuntis folder and execute `git pull`.
2. execute `npm install` to (re-)generate the node dependencies.

## Using the module

To use this module, add it to the modules array in the `config/config.js` file:

```javascript
modules: [
    {
        module: "MMM-Webuntis",
        position: "top_right",
        header: "Untis",
        config: { // see 'Configuration options' for more information
            students: [
                {
                    title: "1st child's name",
                    qrcode: "untis:[...] "
                },
                {
                    title: "2nd child's name",
                    qrcode: "untis:[...] "
                },
            ]
        }
    }
```

## Configuration options

I Am only able to use (and test) the qrcode login, as the school of our kids unfortunately use MS365 logins. If you have any problems with the other login methods i am not able to help you!

The following properties can be configured:

<table>
    <thead>
        <tr>
            <th>Option</th>
            <th width="25%">Description</th>
            <th>default value</th>
        </tr>
    <thead>
        <tr>
            <td><code>header</code></td>
            <td>
                (optional) Printed by MagicMirror² if set <br>
            </td>
            <td></td>
        </tr>
        <tr>
            <td><code>students</code></td>
            <td>
                Array of untis login credentials objects<br>
                <br><b>Possible values:</b> <code>array</code> of objects with the following attributes:
                <table>
                    <tr>
                        <td><code>title</code></td>
                        <td>Title of the entry, e.g. kid's name</td>
                    </tr>
                    <tr>
                        <td><code>qrcode</code></td>
                        <td><b>preferred</b> login-string from qrcode provided by webuntis.<br>
                        You need to login in the student account and go to <br>
                        <code>-> Profile -> Data Access</code><br>
                        to generate a QR code. Adjust the QR code string to match your credentials:<br>
                        <code>'untis://setschool?url=[...]&school=[...]&user=[...]&key=[...]&schoolNumber=[...]';</code></td>
                    </tr>
                    <tr>
                        <td><code>school</code></td>
                        <td><b>alternative to qr</b><br>
                        School name as in the URL after having logged in at <a href="https://webuntis.com/">webuntis.com</a>.<br>
                        A plus sign (+) in the URL can be replaced by a space.</td>
                    </tr>
                    <tr>
                        <td><code>username</code></td>
                        <td><b>alternative to qr</b><br>
                        Username used to login at Untis<br>
                        (Optional, only required if the student has a custom login</td>
                    </tr>
                    <tr>
                        <td><code>password</code></td>
                        <td><b>alternative to qr</b><br>
                        Password used to login at Untis<br>
                        (Optional, only required if the student has a custom login</td>
                    </tr>
                    <tr>
                        <td><code>server</code></td>
                        <td><b>alternative to qr</b><br>
                        Server as shown in the URL after having logged in at <a href="https://webuntis.com/">webuntis.com</a>,<br>
                        e.g. <code>kephiso.webuntis.com</code></td>
                    </tr>
                    <tr>
                        <td><code>class</code></td>
                        <td>Name of class to show<br>
                        (optional, only required if anonymous mode is used)</td>
                    </tr>
                    <tr>
                        <td><code>useClassTimetable</code></td>
                        <td>It seems, that some schools do not provide an individual timetable<br>
                        but only the class timetable. 
                        <br>Try to set this to <code>true</code> if you don't receive any elements.
                        <br><br><b>Default value:</b> <code>false</code></td>
                    </tr>                    
                </table>
            </td>
            <td></td>
        </tr>
        <tr>
            <td><code>days</code></td>
            <td>
            Number of days to look ahead<br>
            <br><b>Possible values:</b> <code>int</code> from <code>0</code> to <code>10</code>.<br>
            Set to <code>0</code> to disable.<br>
            Can also be specified in the <code>students</code> object to override the module's default value.
            </td>
            <td>7</td>
        </tr>
        <tr>
            <td><code>fetchInterval</code></td>
            <td>Interval in milliseconds to fetch data.<br>(default is 15 minutes)</td>
            <td>15 * 60 * 1000</td>
        </tr>
        <tr>
            <td><code>showStartTime</code></td>
            <td>
                Whether time or lesson order number shall be shown<br>
                <br><b>Possible values:</b> <code>true</code> or <code>false</code>
                <br><br>
                The module tries to achieve the timetable of the school<br>
                and currently assumes that Monday's lesson times are valid for the whole week.<br>
                When set to <code>false</code> the module matches a start time like "07:40" to "1." for example.<br>
                Can also be specified in the <code>students</code> object to override the module's default value.
            </td>
            <td>false</td>
        </tr>
        <tr>
            <td><code>showRegularLessons</code></td>
            <td>Boolean to show regular lessons.<br>
            Can also be specified in the <code>students</code> object to override the module's default value.</td>
            <td>false</td>
        </tr>
        <tr>
            <td><code>showTeacher</code></td>
            <td>Boolean to show the teacher's name.<br>
            Can also be specified in the <code>students</code> object to override the module's default value.</td>
            <td>true</td>
        </tr>
        <tr>
            <td><code>shortSubject</code></td>
            <td>Boolean to show the short form of the subject.<br>
            Can also be specified in the <code>students</code> object to override the module's default value.</td>
            <td>false</td>
        </tr>
        <tr>
            <td><code>showSubstText</code></td>
            <td>Boolean to show substitution text.<br>
            Can also be specified in the <code>students</code> object to override the module's default value.</td>
            <td>false</td>
        </tr>
        <tr>
            <td><code>examsDays</code></td>
            <td>Number of days to fetch exams data for.<br>
            Set to <code>0</code> to disable.<br>
            Can also be specified in the <code>students</code> object to override the module's default value. </td>
            <td>0</td>
        </tr>
        <tr>
            <td><code>examsShowTeacher</code></td>
            <td>Boolean to show the teacher's name in exams data.<br>
            Can also be specified in the <code>students</code> object to override the module's default value.</td>
            <td>true</td>
        </tr>
        <tr>
            <td><code>examsShowSubject</code></td>
            <td>Boolean to show the subject in exams data.<br>
            Can also be specified in the <code>students</code> object to override the module's default value.</td>
            <td>true</td>
        </tr>
        <tr>
            <td><code>mode</code></td>
            <td>Show each student as own table, or compact in one table.<br>
            <b>Possible values:</b> <code>verbose</code> or <code>compact</code></td>
            <td>"compact"</td>
        </tr>
        <tr>
            <td><code>debug</code></td>
            <td>Use only for debug purposes!<br>
            If set to true, the timetable from WebUntis and the parsed lessons will be printed to the MM log<br>
            <br><b>Possible values:</b> <code>true</code> or <code>false</code>
            </td>
            <td>false</td>
        </tr>
</table>

## How it works

This module may be useful for students at schools using Untis for the organization of time tables. It uses the node.js wrapper of the WebUnits API by TheNoim and retrieves all lessons in a specified number of days time period. It displays cancelled or irregular subjects so that kids are able to prepare for the next day without pulling the information from the Untis app. The module can be configured for several students.

## Dependencies

- [node.js Wrapper for WebUntis API](https://github.com/TheNoim/WebUntis) (installed via `npm install`)

## Screenshot

"mode: verbose":

![Screenshot](screenshot.png "Screenshot verbose mode")

## Attribution

This project is based on work done by Paul-Vincent Roll in the MMM-Wunderlist module. (<https://github.com/paviro/MMM-Wunderlist>)
