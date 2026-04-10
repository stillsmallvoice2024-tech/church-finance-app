-- Seed data: Account codes and Special Projects
-- Run this AFTER schema.sql in the Supabase SQL Editor

insert into public.accounts (code, name, category, opening_balance) values
('1',   'Tithe Account',                      'income',   47005.22),
('2',   'Tithe Account 2',                     'income',       0.00),
('3',   'Rentals, Transport & Imprest',         'expense',  19842.36),
('5',   'Maintenance',                          'expense',  15477.67),
('6',   'Crusades',                             'expense',  28296.11),
('10',  'Fuel',                                 'expense',  36538.47),
('12',  'Dominion Convention',                  'expense', 1516397.27),
('13',  'Supernatural Life Conference',         'expense',  235329.19),
('14',  'Heart Enlargement Speciale',           'expense',   80367.13),
('15',  'Prosperity Convention',                'expense',    7101.50),
('20',  'Monthly Savings',                      'savings', 1342531.55),
('25',  'Capital Project',                      'savings',  571009.47),
('29',  'General Inflow',                       'income',       0.00),
('33',  'Welfare & Givings',                    'expense',  268966.48),
('35',  'Allowances',                           'expense', 1372858.02),
('42',  'Publicity & Subscriptions',            'expense',  164632.91),
('45',  'Workers Trust Fund',                   'savings',   38707.37),
('50',  'Heart Enlargement Ministry (HEM)',      'ministry',      3.67),
('51',  'HEM Lagos',                            'ministry',     47.28),
('60',  'Available Investment',                 'savings',   27255.55),
('100', 'Prophets Seed',                        'special',      0.00),
('200', 'Zonal Crusades',                       'ministry',  85895.00);

insert into public.special_projects (name, code, opening_balance) values
('DC Sacrifice 2023',        'SP-01',  63520.00),
('Church Building',          'SP-02',  80914.98),
('Church ACS',               'SP-03', 501289.49),
('Church Building Project',  'SP-04', 194850.00),
('Generator Project',        'SP-05',  30557.12),
('Billboard Project',        'SP-06',  51811.79),
('Church Painting',          'SP-07', 100000.00);
