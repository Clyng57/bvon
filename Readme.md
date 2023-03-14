
# BVON
[![JavaScript Style Guide](https://cdn.rawgit.com/standard/standard/master/badge.svg)](https://github.com/standard/standard)

Serialize data into a buffer. Result size is smaller than BSON and JSON. Browser or NodeJS.

<br />

## Table of Contents
- [ Installation ](#install)
- [ Usage ](#usage)

<br />

<a name="install"></a>
## Install

```console
npm i bvon
```

<br />

<a name="usage"></a>
## Usage


### static (class) `BVON.serialize`:

Args [`data: any`, `schema?: BVON.Schema`]

Returns `ByteView`

#### without schema:
```js
import BVON, { UOID } from 'bvon'

const user = {
  id: new UOID('2LD32T9NBPMF3YDQYLVANMG22A2J'),
  name: {
    first: 'Mike',
    last: 'Williamson'
  },
  createdAt: new Date('2023-03-02T06:00:00.000Z'),
  modifiedAt: new Date('2023-03-13T06:00:00.000Z'),
  settings: {
    theme: 'dark',
    fontSize: 15,
    formOfContact: 'text'
  },
  phone: '8889991234'
}

console.log(BVON.serialize(user))

/*
prints: <ByteView(216) 09 08 06 06 08 02 69 64 10 08 
1c 32 4c 44 33 32 54 39 4e 42 50 4d 46 33 59 44 51 59 
4c 56 41 4e 4d 47 32 32 41 32 4a 06 08 04 6e 61 6d 65 
09 08 02 06 08 05 66 69 72 73 74 06 08 04 4d 69 6b 65 
06 08 04 6c 61 73 74 06 08 0a 57 69 6c 6c 69 61 6d 
...136 more bytes />
*/
```

#### with schema:
```js
import BVON, { UOID } from 'bvon'

const user = {
  id: new UOID('2LD32T9NBPMF3YDQYLVANMG22A2J'),
  name: {
    first: 'Mike',
    last: 'Williamson'
  },
  createdAt: new Date('2023-03-02T06:00:00.000Z'),
  modifiedAt: new Date('2023-03-13T06:00:00.000Z'),
  settings: {
    theme: 'dark',
    fontSize: 15,
    formOfContact: 'text'
  },
  phone: '8889991234'
}

const userSchema = new BVON.Schema({
  id: 'UOID',
  name: {
    first: 'String',
    last: 'String'
  },
  createdAt: 'Date',
  modifiedAt: 'Date',
  settings: {
    theme: 'String',
    fontSize: 'Number',
    formOfContact: 'String'
  },
  phone: 'String'
})

console.log(BVON.serialize(user, userSchema))

/*
prints: <ByteView(143) 09 08 06 0e 08 01 10 08 1c 
32 4c 44 33 32 54 39 4e 42 50 4d 46 33 59 44 51 59 
4c 56 41 4e 4d 47 32 32 41 32 4a 0e 08 02 09 08 02 
0e 08 03 06 08 04 4d 69 6b 65 0e 08 04 06 08 0a 57 
69 6c 6c 69 61 6d 73 6f 6e 0e 08 05 08 00 ef e7 a0 
86 01 00 00 ...63 more bytes />
*/
```


### (method) `BVON.deserialize`:

Args [`data: any`, `schema?: BVON.Schema`]

If the data was serialized using a schema, it must also be deserialized with a schema.

Returns `any`

```js
import BVON from 'bvon'

console.log(BVON.deserialize(serializedUser))

/*
{
  id: UOID('2LD32T9NBPMF3YDQYLVANMG22A2J'),
  name: { first: 'Mike', last: 'Williamson' },
  createdAt: 2023-03-02T06:00:00.000Z,
  modifiedAt: 2023-03-13T06:00:00.000Z,
  settings: { theme: 'dark', fontSize: 15, formOfContact: 'text' },
  phone: '8889991234'
}
*/
```
